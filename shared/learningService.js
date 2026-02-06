/**
 * Learning Service - Sistema de Aprendizado do Bot
 * 
 * Gerencia perguntas pendentes, encaminhamento ao admin,
 * e aprendizado de novas respostas.
 */

const fs = require('fs');
const path = require('path');

// Gerador simples de IDs (sem dependência externa)
function generateId() {
    return Math.random().toString(36).substring(2, 10);
}

const PENDING_FILE = path.join(__dirname, 'pendingQuestions.json');
const LEARNED_FILE = path.join(__dirname, 'learnedResponses.json');
const CONFIG_FILE = path.join(__dirname, 'botConfig.json');

// Lista de admins (qualquer um pode responder)
const ADMIN_NUMBERS = [
    '5521990338405',  // Pablo
    '5524992346509',  // Sandro
    '5524999242217'   // Joana
];

class LearningService {
    constructor() {
        this.pendingQuestions = this.loadPending();
        this.learnedResponses = this.loadLearned();
        this.config = this.loadConfig();
    }

    loadConfig() {
        try {
            const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
            return JSON.parse(data);
        } catch {
            return { adminGroupJid: null };
        }
    }

    saveConfig() {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(this.config, null, 2), 'utf-8');
    }

    /**
     * Define o grupo para encaminhamento de perguntas
     */
    setAdminGroup(groupJid) {
        this.config.adminGroupJid = groupJid;
        this.saveConfig();
        console.log(`[Learning] Grupo admin salvo: ${groupJid}`);
    }

    /**
     * Retorna o JID do grupo (ou null se não configurado)
     */
    getAdminGroupJid() {
        return this.config.adminGroupJid || null;
    }

    /**
     * Retorna JID principal para envio (grupo ou primeiro admin)
     */
    getAdminJid() {
        if (this.config.adminGroupJid) {
            return this.config.adminGroupJid;
        }
        return `${ADMIN_NUMBERS[0]}@s.whatsapp.net`;
    }

    /**
     * Retorna array com JIDs de todos os admins (para fallback)
     */
    getAllAdminJids() {
        return ADMIN_NUMBERS.map(n => `${n}@s.whatsapp.net`);
    }

    /**
     * Retorna número do primeiro admin (para compatibilidade)
     */
    getAdminNumber() {
        return ADMIN_NUMBERS[0];
    }

    /**
     * Retorna todos os números de admin
     */
    getAllAdminNumbers() {
        return ADMIN_NUMBERS;
    }

    /**
     * Verifica se um número é admin
     */
    isAdmin(phoneNumber) {
        const cleanNumber = phoneNumber.replace('@s.whatsapp.net', '').replace('@lid', '');
        return ADMIN_NUMBERS.includes(cleanNumber);
    }

    /**
     * Verifica se mensagem vem do grupo admin
     */
    isFromAdminGroup(jid) {
        return this.config.adminGroupJid && jid === this.config.adminGroupJid;
    }

    /**
     * Verifica se grupo está disponível
     */
    hasAdminGroup() {
        return !!this.config.adminGroupJid;
    }

    // ==========================================
    // NOTIFICAÇÕES DE LEADS
    // ==========================================

    /**
     * Formata notificação de interesse em turma (Opção 1 - Minimalista)
     */
    formatTurmaLeadNotification(clientName, phoneNumber, turmaType) {
        const turmaNames = {
            'semanal': 'Turma Semanal (Seg-Sex 19h-22h)',
            'sabado': 'Turma aos Sábados (09h-17h)'
        };
        const turmaName = turmaNames[turmaType] || turmaType;

        return `🔔 *INTERESSE EM TURMA*\n\n` +
            `*${clientName}* escolheu:\n` +
            `📚 ${turmaName}`;
    }

    /**
     * Formata notificação de pedido de atendente (Opção 4 - Card separado)
     */
    formatAttendantLeadNotification(clientName, phoneNumber, context = '') {
        return `🙋 *QUER FALAR COM ATENDENTE*\n\n` +
            `*${clientName}* pediu atendimento humano!`;
    }

    /**
     * Formata número de telefone para exibição
     */
    formatPhoneNumber(phone) {
        // Se for um LID (número interno do WhatsApp), tenta converter ou mostra original
        const clean = phone.replace(/\D/g, '');

        // Formato brasileiro: 5521999999999 (13 dígitos) ou 5521999999999 (12 sem 9)
        if (clean.length === 13 && clean.startsWith('55')) {
            const ddd = clean.substring(2, 4);
            const num = clean.substring(4);
            return `+55 ${ddd} ${num.substring(0, 5)}-${num.substring(5)}`;
        }
        if (clean.length === 12 && clean.startsWith('55')) {
            const ddd = clean.substring(2, 4);
            const num = clean.substring(4);
            return `+55 ${ddd} ${num.substring(0, 4)}-${num.substring(4)}`;
        }
        // Se for número muito longo (provavelmente lid), mostra aviso
        if (clean.length > 15) {
            return `[Número não disponível]`;
        }
        return phone;
    }

    // ==========================================
    // CARREGAMENTO DE DADOS
    // ==========================================
    loadPending() {
        try {
            const data = fs.readFileSync(PENDING_FILE, 'utf-8');
            return JSON.parse(data);
        } catch {
            return { questions: [] };
        }
    }

    loadLearned() {
        try {
            const data = fs.readFileSync(LEARNED_FILE, 'utf-8');
            return JSON.parse(data);
        } catch {
            return { responses: [] };
        }
    }

    savePending() {
        fs.writeFileSync(PENDING_FILE, JSON.stringify(this.pendingQuestions, null, 2), 'utf-8');
    }

    saveLearned() {
        fs.writeFileSync(LEARNED_FILE, JSON.stringify(this.learnedResponses, null, 2), 'utf-8');
    }

    /**
     * Retorna todas as perguntas/respostas aprendidas para análise semântica
     */
    getAllLearnedQuestions() {
        return this.learnedResponses.responses || [];
    }

    // ==========================================
    // BUSCA EM RESPOSTAS APRENDIDAS
    // ==========================================
    findLearnedResponse(userMessage) {
        const msgLower = userMessage.toLowerCase().trim();

        let bestMatch = null;
        let bestScore = 0;

        for (const resp of this.learnedResponses.responses) {
            const keywords = resp.keywords || [];
            if (keywords.length === 0) continue;

            // Conta quantas keywords da resposta batem com a mensagem
            let matchCount = 0;
            for (const kw of keywords) {
                if (msgLower.includes(kw.toLowerCase())) {
                    matchCount++;
                }
            }

            // Calcula score (percentual de keywords que bateram)
            const score = matchCount / keywords.length;

            // Requer pelo menos 40% das keywords OU pelo menos 2 matches
            // Isso evita que uma keyword genérica como "curso" dê match sozinha
            if (score >= 0.4 || matchCount >= 2) {
                if (score > bestScore) {
                    bestScore = score;
                    bestMatch = resp;
                }
            }
        }

        if (bestMatch) {
            console.log(`[Learning] Resposta aprendida encontrada (score: ${(bestScore * 100).toFixed(0)}%)`);
            return bestMatch.answer;
        }

        // Verifica similaridade com a pergunta original
        for (const resp of this.learnedResponses.responses) {
            if (resp.question && this.isSimilar(msgLower, resp.question.toLowerCase())) {
                console.log(`[Learning] Pergunta similar encontrada`);
                return resp.answer;
            }
        }

        return null;
    }

    isSimilar(str1, str2) {
        // Normaliza strings
        const normalize = (s) => s.toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^\w\s]/g, '');

        const words1 = normalize(str1).split(/\s+/).filter(w => w.length > 2);
        const words2 = normalize(str2).split(/\s+/).filter(w => w.length > 2);

        if (words1.length === 0 || words2.length === 0) return false;

        // Conta palavras que dão match (incluindo parciais)
        let matches = 0;
        for (const w1 of words1) {
            if (words2.some(w2 => w2.includes(w1) || w1.includes(w2) ||
                (w1.length > 4 && w2.length > 4 && (w1.substring(0, 4) === w2.substring(0, 4))))) {
                matches++;
            }
        }

        // Reduzido para 40% para pegar mais variações (antes era 60%)
        return (matches / Math.max(words1.length, words2.length)) >= 0.4;
    }

    // ==========================================
    // GERENCIAMENTO DE PERGUNTAS PENDENTES
    // ==========================================
    addPendingQuestion(clientJid, clientName, question) {
        const id = generateId();
        const pending = {
            id,
            clientJid,
            clientName: clientName || 'Cliente',
            question,
            timestamp: new Date().toISOString(),
            status: 'pending'
        };

        this.pendingQuestions.questions.push(pending);
        this.savePending();

        console.log(`[Learning] Pergunta pendente adicionada: ${id}`);
        return pending;
    }

    getOldestPending() {
        return this.pendingQuestions.questions.find(q => q.status === 'pending');
    }

    getPendingById(id) {
        return this.pendingQuestions.questions.find(q => q.id === id);
    }

    getPendingByClient(clientJid) {
        return this.pendingQuestions.questions.find(
            q => q.clientJid === clientJid && q.status === 'pending'
        );
    }

    markAsAnswered(id) {
        const q = this.getPendingById(id);
        if (q) {
            q.status = 'answered';
            this.savePending();
        }
    }

    // ==========================================
    // APRENDIZADO DE NOVAS RESPOSTAS
    // ==========================================
    learnResponse(question, answer, keywords = []) {
        // Gera keywords automaticamente se não fornecidas
        if (keywords.length === 0) {
            keywords = this.extractKeywords(question);
        }

        const learned = {
            keywords,
            question,
            answer,
            learnedAt: new Date().toISOString()
        };

        // Evita duplicatas
        const existing = this.learnedResponses.responses.find(
            r => r.question.toLowerCase() === question.toLowerCase()
        );

        if (existing) {
            existing.answer = answer;
            existing.keywords = [...new Set([...existing.keywords, ...keywords])];
        } else {
            this.learnedResponses.responses.push(learned);
        }

        this.saveLearned();
        console.log(`[Learning] Nova resposta aprendida: "${question.substring(0, 30)}..."`);

        return learned;
    }

    extractKeywords(text) {
        // Extrai palavras-chave relevantes (> 4 chars, sem stopwords)
        const stopwords = ['para', 'como', 'qual', 'quando', 'onde', 'porque', 'será', 'esta', 'esse', 'essa', 'vocês', 'voces'];
        const words = text.toLowerCase()
            .replace(/[?!.,]/g, '')
            .split(/\s+/)
            .filter(w => w.length > 4 && !stopwords.includes(w));

        return [...new Set(words)].slice(0, 5);
    }

    // ==========================================
    // MENSAGENS FORMATADAS
    // ==========================================
    getAdminForwardMessage(pending) {
        return `📩 *NOVA PERGUNTA DE CLIENTE*\n\n` +
            `👤 *De:* ${pending.clientName}\n` +
            `📱 *Número:* ${pending.clientJid.replace('@s.whatsapp.net', '')}\n` +
            `🆔 *ID:* ${pending.id}\n\n` +
            `❓ *Pergunta:*\n"${pending.question}"\n\n` +
            `━━━━━━━━━━━━━━━\n` +
            `Para responder, envie:\n` +
            `*#${pending.id} [sua resposta]*\n\n` +
            `Exemplo:\n` +
            `#${pending.id} Estaremos em recesso no carnaval.`;
    }

    getPendingResponseMessage() {
        return `🤔 *Boa pergunta!*\n\n` +
            `Vou verificar essa informação com nossa equipe e já retorno com a resposta.\n\n` +
            `⏳ Aguarde um momento, por favor.\n\n` +
            `_Ou digite *MENU* para ver outras opções._`;
    }

    // ==========================================
    // PARSE DE RESPOSTA DO ADMIN
    // ==========================================
    parseAdminResponse(text) {
        // Formato esperado: #ID resposta
        const match = text.match(/^#([a-z0-9]+)\s+(.+)/is);

        if (match) {
            return {
                id: match[1],
                answer: match[2].trim()
            };
        }
        return null;
    }

    // ==========================================
    // COMANDOS DE GERENCIAMENTO DE MEMÓRIA
    // ==========================================

    /**
     * Processa comandos de memória (!memoria, !editar, !apagar, !adicionar)
     * Retorna null se não for comando, ou objeto com resposta se for
     */
    processMemoryCommand(text) {
        const trimmed = text.trim().toLowerCase();

        // !memoria ou !memória - lista respostas aprendidas
        if (trimmed === '!memoria' || trimmed === '!memória' || trimmed === '!listar') {
            return this.listLearnedResponses();
        }

        // !apagar ID - remove resposta por índice
        const deleteMatch = text.match(/^!apagar\s+(\d+)/i);
        if (deleteMatch) {
            return this.deleteLearnedResponse(parseInt(deleteMatch[1]));
        }

        // !editar ID nova_resposta - edita resposta
        const editMatch = text.match(/^!editar\s+(\d+)\s+(.+)/is);
        if (editMatch) {
            return this.editLearnedResponse(parseInt(editMatch[1]), editMatch[2].trim());
        }

        // !ver N - mostra pergunta+resposta completa
        const viewMatch = text.match(/^!ver\s+(\d+)/i);
        if (viewMatch) {
            return this.viewLearnedResponse(parseInt(viewMatch[1]));
        }

        // !adicionar pergunta | resposta
        const addMatch = text.match(/^!adicionar\s+(.+?)\s*\|\s*(.+)/is);
        if (addMatch) {
            return this.addManualResponse(addMatch[1].trim(), addMatch[2].trim());
        }

        // !ajuda ou !comandos
        if (trimmed === '!ajuda' || trimmed === '!comandos' || trimmed === '!help') {
            return this.getHelpMessage();
        }

        // !pendentes - lista perguntas aguardando resposta
        if (trimmed === '!pendentes' || trimmed === '!fila' || trimmed === '!aguardando') {
            return this.listPendingQuestions();
        }

        return null;
    }

    listPendingQuestions() {
        const pending = this.pendingQuestions.questions.filter(q => q.status === 'pending');

        if (pending.length === 0) {
            return '✅ *Nenhuma pergunta pendente!*\n\nTodas as perguntas foram respondidas.';
        }

        let msg = `📋 *PERGUNTAS PENDENTES*\n` +
            `Total: ${pending.length} aguardando resposta\n\n`;

        pending.forEach((q, i) => {
            const timeAgo = this.getTimeAgo(q.timestamp);
            msg += `*${i + 1}. ${q.clientName}* (${timeAgo})\n` +
                `🆔 ID: *${q.id}*\n` +
                `❓ "${q.question.substring(0, 60)}..."\n\n`;
        });

        msg += `━━━━━━━━━━━━━━━\n`;
        msg += `Para responder:\n`;
        msg += `*#ID [resposta]* ou marque a mensagem`;

        return msg;
    }

    getTimeAgo(timestamp) {
        const now = new Date();
        const then = new Date(timestamp);
        const diffMs = now - then;
        const diffMins = Math.floor(diffMs / 60000);

        if (diffMins < 1) return 'agora';
        if (diffMins < 60) return `${diffMins}min`;
        const diffHours = Math.floor(diffMins / 60);
        if (diffHours < 24) return `${diffHours}h`;
        const diffDays = Math.floor(diffHours / 24);
        return `${diffDays}d`;
    }

    listLearnedResponses() {
        const responses = this.learnedResponses.responses || [];
        if (responses.length === 0) {
            return '📚 *Memória vazia* - Nenhuma resposta aprendida ainda.';
        }

        let msg = `📚 *MEMÓRIA DO BOT*\n` +
            `Total: ${responses.length} resposta(s)\n\n`;

        responses.slice(0, 20).forEach((r, i) => {
            const question = r.question ? r.question.substring(0, 40) : '(sem pergunta)';
            const answer = r.answer.substring(0, 50);
            msg += `*${i + 1}.* "${question}..."\n    ↳ "${answer}..."\n\n`;
        });

        if (responses.length > 20) {
            msg += `_... e mais ${responses.length - 20} respostas_\n\n`;
        }

        msg += `━━━━━━━━━━━━━━━\n`;
        msg += `*Comandos:*\n`;
        msg += `!apagar ID - Remove resposta\n`;
        msg += `!editar ID [nova resposta]\n`;
        msg += `!adicionar [pergunta] | [resposta]`;

        return msg;
    }

    viewLearnedResponse(index) {
        const responses = this.learnedResponses.responses || [];
        if (index < 1 || index > responses.length) {
            return `⚠️ ID inválido. Use um número entre 1 e ${responses.length}.`;
        }

        const item = responses[index - 1];
        const keywords = item.keywords?.join(', ') || 'Nenhuma';

        return `📖 *RESPOSTA #${index}*\n\n` +
            `*Pergunta:*\n${item.question || 'N/A'}\n\n` +
            `*Resposta:*\n${item.answer}\n\n` +
            `*Keywords:* ${keywords}\n` +
            `*Aprendida em:* ${item.learnedAt || item.timestamp || 'N/A'}`;
    }

    deleteLearnedResponse(index) {
        const responses = this.learnedResponses.responses || [];
        if (index < 1 || index > responses.length) {
            return `⚠️ ID inválido. Use um número entre 1 e ${responses.length}.`;
        }

        const removed = responses.splice(index - 1, 1)[0];
        this.saveLearned();

        return `🗑️ *Resposta removida!*\n\nPergunta: "${removed.question || 'N/A'}"`;
    }

    editLearnedResponse(index, newAnswer) {
        const responses = this.learnedResponses.responses || [];
        if (index < 1 || index > responses.length) {
            return `⚠️ ID inválido. Use um número entre 1 e ${responses.length}.`;
        }

        const item = responses[index - 1];
        const oldAnswer = item.answer;
        item.answer = newAnswer;
        this.saveLearned();

        return `✏️ *Resposta atualizada!*\n\n` +
            `*Pergunta:* ${item.question || 'N/A'}\n\n` +
            `*Resposta Antiga:*\n${oldAnswer}\n\n` +
            `*Resposta Nova:*\n${newAnswer}`;
    }

    addManualResponse(question, answer) {
        const keywords = this.extractKeywords(question);

        this.learnedResponses.responses.push({
            question,
            answer,
            keywords,
            timestamp: new Date().toISOString(),
            source: 'manual'
        });
        this.saveLearned();

        return `✅ *Resposta adicionada!*\n\n` +
            `Pergunta: "${question.substring(0, 50)}..."\n` +
            `Resposta: "${answer.substring(0, 50)}..."\n` +
            `Keywords: ${keywords.join(', ')}`;
    }

    getHelpMessage() {
        return `🤖 *COMANDOS DO BOT*\n\n` +
            `*Respostas:*\n` +
            `#ID [resposta] - Responde pergunta\n` +
            `Ou: Marque a mensagem e responda\n\n` +
            `*Memória:*\n` +
            `!memoria - Lista respostas salvas\n` +
            `!ver N - Ver pergunta/resposta completa\n` +
            `!pendentes - Perguntas aguardando\n` +
            `!apagar N - Remove resposta N\n` +
            `!editar N [nova resposta]\n` +
            `!adicionar [pergunta] | [resposta]`;
    }
}

module.exports = new LearningService();

/**
 * Learning Service - Sistema de Aprendizado do Bot
 * 
 * Gerencia perguntas pendentes, encaminhamento ao admin,
 * e aprendizado de novas respostas.
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const PENDING_FILE = path.join(__dirname, 'pendingQuestions.json');
const LEARNED_FILE = path.join(__dirname, 'learnedResponses.json');
const ADMIN_NUMBER = '5521990338405';

class LearningService {
    constructor() {
        this.pendingQuestions = this.loadPending();
        this.learnedResponses = this.loadLearned();
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

    // ==========================================
    // BUSCA EM RESPOSTAS APRENDIDAS
    // ==========================================
    findLearnedResponse(userMessage) {
        const msgLower = userMessage.toLowerCase().trim();

        for (const resp of this.learnedResponses.responses) {
            // Verifica se alguma keyword bate
            for (const kw of resp.keywords || []) {
                if (msgLower.includes(kw.toLowerCase())) {
                    console.log(`[Learning] Resposta aprendida encontrada para: "${kw}"`);
                    return resp.answer;
                }
            }

            // Verifica similaridade com a pergunta original
            if (resp.question && this.isSimilar(msgLower, resp.question.toLowerCase())) {
                console.log(`[Learning] Pergunta similar encontrada`);
                return resp.answer;
            }
        }
        return null;
    }

    isSimilar(str1, str2) {
        // Verifica se >= 60% das palavras são iguais
        const words1 = str1.split(/\s+/).filter(w => w.length > 3);
        const words2 = str2.split(/\s+/).filter(w => w.length > 3);

        if (words1.length === 0 || words2.length === 0) return false;

        let matches = 0;
        for (const w1 of words1) {
            if (words2.some(w2 => w2.includes(w1) || w1.includes(w2))) {
                matches++;
            }
        }

        return (matches / Math.max(words1.length, words2.length)) >= 0.6;
    }

    // ==========================================
    // GERENCIAMENTO DE PERGUNTAS PENDENTES
    // ==========================================
    addPendingQuestion(clientJid, clientName, question) {
        const id = uuidv4().substring(0, 8);
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

    getAdminNumber() {
        return ADMIN_NUMBER;
    }

    getAdminJid() {
        return `${ADMIN_NUMBER}@s.whatsapp.net`;
    }

    // ==========================================
    // PARSE DE RESPOSTA DO ADMIN
    // ==========================================
    parseAdminResponse(text) {
        // Formato esperado: #ID resposta
        const match = text.match(/^#([a-f0-9]+)\s+(.+)/is);

        if (match) {
            return {
                id: match[1],
                answer: match[2].trim()
            };
        }
        return null;
    }
}

module.exports = new LearningService();

/**
 * Handler de respostas - Menu Principal
 * 
 * Fluxo: 
 * 1. Verifica opções do menu (1-4)
 * 2. Verifica respostas aprendidas
 * 3. Encaminha desconhecidas ao admin
 */

const fs = require('fs');
const path = require('path');
const learningService = require('./learningService');
const geminiService = require('./geminiService');

const RESPOSTAS_FILE = path.join(__dirname, 'respostas.json');

class ResponseHandler {
    constructor() {
        this.loadRespostas();
        this.userStates = new Map(); // Rastreia estado de conversa (ex: selecting_turma)
    }

    /**
     * Métodos de estado de usuário
     */
    setUserState(phone, state) {
        this.userStates.set(phone, state);
        console.log(`[ResponseHandler] Estado definido: ${phone} → ${state}`);
    }

    getUserState(phone) {
        return this.userStates.get(phone) || null;
    }

    clearUserState(phone) {
        this.userStates.delete(phone);
    }

    /**
     * Carrega respostas do arquivo JSON
     */
    loadRespostas() {
        try {
            delete require.cache[require.resolve('./respostas.json')];
            this.respostas = JSON.parse(fs.readFileSync(RESPOSTAS_FILE, 'utf-8'));
        } catch (err) {
            console.error('[ResponseHandler] Erro ao carregar respostas.json:', err.message);
            this.respostas = { mensagens: {}, menu_principal: {} };
        }
    }

    /**
     * Recarrega respostas (para atualizações em tempo real)
     */
    reloadRespostas() {
        this.loadRespostas();
        console.log('[ResponseHandler] Respostas recarregadas do arquivo.');
    }

    /**
     * Normaliza texto para comparação
     */
    normalizeText(text) {
        return text
            .toLowerCase()
            .trim()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');
    }

    /**
     * Retorna mensagem de boas-vindas
     */
    getWelcomeMessage() {
        return this.respostas.mensagens?.boas_vindas ||
            '*Olá! Bem-vindo(a) à SILFER CONCURSOS!*\n\nDigite MENU para ver as opções.';
    }

    /**
     * Retorna mensagem do menu principal
     */
    getMenuMessage() {
        return this.respostas.mensagens?.menu || this.getWelcomeMessage();
    }

    /**
     * Verifica se é pedido de MENU (apenas palavra MENU, não saudações)
     */
    isMenuRequest(message) {
        const normalized = this.normalizeText(message);
        const menuTriggers = ['menu', 'opcoes', 'opções', 'inicio', 'início', 'voltar'];
        return menuTriggers.some(trigger => normalized === trigger || normalized.includes(trigger));
    }

    /**
     * Verifica se é saudação (oi, bom dia, etc) - deve mostrar boas-vindas
     */
    isGreeting(message) {
        const normalized = this.normalizeText(message);
        const greetings = [
            'oi', 'ola', 'olá', 'opa', 'eai', 'e ai', 'eae',
            'bom dia', 'boa tarde', 'boa noite', 'bom-dia', 'boa-tarde', 'boa-noite',
            'hello', 'hi', 'hey', 'oii', 'oie', 'oin',
            'salve', 'fala', 'iae', 'tudo bem', 'td bem', 'tudo bom'
        ];
        return greetings.some(g => normalized === g || normalized.startsWith(g + ' ') || normalized.startsWith(g + ',') || normalized.startsWith(g + '!'));
    }

    /**
     * Verifica se é mensagem de encerramento/confirmação simples
     * Ex: "Tá bom", "Ok", "Certo", "Obrigado", etc.
     */
    isClosingMessage(message) {
        const normalized = this.normalizeText(message);
        const closingPhrases = [
            // Confirmações básicas
            'ta bom', 'tá bom', 'tabom', 'ta bem', 'tá bem', 'ta certo', 'ta otimo',
            'ok', 'okay', 'okk', 'okok', 'okzinho',
            'certo', 'certinho', 'certeza', 'ctz',
            'beleza', 'blz', 'bele', 'blzinha',
            'entendi', 'entendido', 'compreendi', 'saquei', 'boto fe',
            // Agradecimentos
            'obrigado', 'obrigada', 'obg', 'obgg', 'brigado', 'brigada',
            'vlw', 'vlww', 'valeu', 'valeuu', 'valew',
            'agradeco', 'agradeço', 'grato', 'grata',
            // Gírias de aprovação
            'show', 'perfeito', 'otimo', 'ótimo', 'maravilha', 'excelente',
            'massa', 'top', 'topp', 'dahora', 'legal', 'irado', 'sinistro',
            'firmeza', 'firmezinha', 'suave', 'suavinho', 'tranquilo', 'tranquilidade',
            'de boa', 'dboa', 'dboas', 'na paz',
            // Gírias de despedida/fechamento
            'tmj', 'tmjj', 'tamo junto', 'estamos junto',
            'pdp', 'pode pa', 'pode crer', 'e nois', 'eh nois', 'e noix',
            'fechou', 'feito', 'combinado', 'combinadinho', 'combinadao',
            'bora', 'bora la', 'partiu',
            // Despedidas
            'ate mais', 'ate logo', 'ate', 'tchau', 'xau', 'flw', 'flww', 'fui', 'fuiii',
            'bjs', 'bjss', 'beijo', 'beijos', 'abss', 'abraco', 'abracos',
            // Outras
            'show de bola', 'bom saber', 'boa', 'boaa', 'boaaa',
            'pode ser', 'pode', 'sim', 'sss', 'simm', 'isso', 'isso mesmo', 'exato',
            's2', 'amo', 'amoo', 'adoro'
        ];
        return closingPhrases.some(c => normalized === c || normalized === c + '!' || normalized === c + '.');
    }

    /**
     * Retorna resposta para mensagem de encerramento
     */
    getClosingResponse() {
        const responses = [
            '😊 Que bom! Qualquer dúvida, estamos à disposição!\n\n_Digite *MENU* para ver as opções._',
            '✨ Perfeito! Se precisar de algo, é só chamar!\n\n_Digite *MENU* para ver as opções._',
            '👍 Combinado! Estamos aqui se precisar.\n\n_Digite *MENU* para ver as opções._'
        ];
        return responses[Math.floor(Math.random() * responses.length)];
    }


    /**
     * Verifica se é seleção de turma específica
     */
    checkTurmaSelection(message) {
        const normalized = this.normalizeText(message);
        const trimmed = message.trim();

        // Detecta seleção de turma semanal
        const semanalTriggers = ['semanal', 'noite', 'noturno', 'segunda', 'semana'];
        if (trimmed === '1' || semanalTriggers.some(t => normalized.includes(t))) {
            // Verifica se está no contexto de turmas (último estado)
            return this.respostas.mensagens?.turma_semanal || null;
        }

        // Detecta seleção de turma sábado
        const sabadoTriggers = ['sabado', 'sábado', 'sabados', 'sábados', 'fim de semana'];
        if (trimmed === '2' || sabadoTriggers.some(t => normalized.includes(t))) {
            return this.respostas.mensagens?.turma_sabado || null;
        }

        return null;
    }

    /**
     * Verifica se é uma pergunta específica (não deve triggar resposta automática)
     */
    isSpecificQuestion(message) {
        const normalized = this.normalizeText(message);

        // Se tem ? e mais de 20 caracteres, provavelmente é pergunta específica
        if (message.includes('?') && message.length > 20) {
            return true;
        }

        // Palavras interrogativas que indicam pergunta específica
        const questionWords = ['posso', 'quando', 'como faço', 'será que', 'é possível', 'e possivel', 'tem como', 'dá para', 'da pra', 'pode ser'];
        if (questionWords.some(w => normalized.includes(w))) {
            return true;
        }

        return false;
    }

    /**
     * Verifica se é uma opção do menu principal (1-4)
     */
    checkMenuOption(message) {
        const trimmed = message.trim();
        const menu = this.respostas.menu_principal;

        // Verifica número direto (1, 2, 3, 4) - sempre responde
        const optionKey = `opcao_${trimmed}`;
        if (menu[optionKey]) {
            const opcao = menu[optionKey];
            const msgKey = this.getMessageKeyFromOption(trimmed);
            return this.respostas.mensagens?.[msgKey] || null;
        }

        // Se é pergunta específica, NÃO trigga por keyword (vai para admin)
        if (this.isSpecificQuestion(message)) {
            return null;
        }

        // Verifica por gatilhos (palavras-chave)
        const normalized = this.normalizeText(message);
        for (const [key, opcao] of Object.entries(menu)) {
            if (opcao.gatilhos) {
                for (const gatilho of opcao.gatilhos) {
                    if (normalized.includes(this.normalizeText(gatilho))) {
                        const optNum = key.replace('opcao_', '');
                        const msgKey = this.getMessageKeyFromOption(optNum);
                        return this.respostas.mensagens?.[msgKey] || null;
                    }
                }
            }
        }

        return null;
    }

    /**
     * Mapeia opção para chave de mensagem
     */
    getMessageKeyFromOption(optionNum) {
        const mapping = {
            '1': 'turmas',
            '2': 'localizacao',
            '3': 'investimento',
            '4': 'atendimento'
        };
        return mapping[optionNum] || null;
    }

    /**
     * Verifica respostas aprendidas
     */
    checkLearnedResponses(message) {
        return learningService.findLearnedResponse(message);
    }

    /**
     * Verifica respostas aprendidas salvas no JSON
     */
    checkJsonLearnedResponses(message) {
        const learned = this.respostas.respostas_aprendidas || {};
        const normalized = this.normalizeText(message);

        for (const [pergunta, resposta] of Object.entries(learned)) {
            if (normalized.includes(this.normalizeText(pergunta)) ||
                this.normalizeText(pergunta).includes(normalized)) {
                return resposta;
            }
        }
        return null;
    }

    /**
     * Processa mensagem e retorna resposta
     */
    async processMessage(message, clientInfo = {}) {
        if (!message || typeof message !== 'string') {
            return null;
        }

        const phoneNumber = clientInfo.phone;
        console.log(`[ResponseHandler] Processando: "${message}"`);

        // 1. Verifica se é pedido de MENU (reseta estado)
        if (this.isMenuRequest(message)) {
            console.log('[ResponseHandler] Resposta via: MENU');
            if (phoneNumber) this.clearUserState(phoneNumber);
            return { type: 'response', text: this.getMenuMessage() };
        }

        // 2. Verifica se usuário está no submenu de turmas
        const userState = phoneNumber ? this.getUserState(phoneNumber) : null;
        if (userState === 'selecting_turma') {
            const trimmed = message.trim();
            if (trimmed === '1') {
                console.log('[ResponseHandler] Resposta via: TURMA SEMANAL');
                this.clearUserState(phoneNumber);
                return { type: 'response', text: this.respostas.mensagens?.turma_semanal };
            }
            if (trimmed === '2') {
                console.log('[ResponseHandler] Resposta via: TURMA SÁBADO');
                this.clearUserState(phoneNumber);
                return { type: 'response', text: this.respostas.mensagens?.turma_sabado };
            }
        }

        // 3. Verifica opção do menu principal (1-4 ou palavras-chave)
        let response = this.checkMenuOption(message);
        if (response) {
            console.log('[ResponseHandler] Resposta via: OPÇÃO MENU');
            // Se é menu de turmas, marca estado
            if (response === this.respostas.mensagens?.turmas && phoneNumber) {
                this.setUserState(phoneNumber, 'selecting_turma');
            }
            return { type: 'response', text: response };
        }

        // 4. Verifica seleção de turma por palavras-chave
        response = this.checkTurmaSelection(message);
        if (response) {
            console.log('[ResponseHandler] Resposta via: TURMA SELEÇÃO');
            if (phoneNumber) this.clearUserState(phoneNumber);
            return { type: 'response', text: response };
        }

        // 5. Verifica respostas aprendidas (arquivo learningService)
        response = this.checkLearnedResponses(message);
        if (response) {
            console.log('[ResponseHandler] Resposta via: APRENDIDA');
            return { type: 'response', text: response };
        }

        // 6. Verifica respostas aprendidas (JSON local)
        response = this.checkJsonLearnedResponses(message);
        if (response) {
            console.log('[ResponseHandler] Resposta via: JSON APRENDIDA');
            return { type: 'response', text: response };
        }

        // 7. Verifica se é mensagem de encerramento/confirmação simples
        if (this.isClosingMessage(message)) {
            console.log('[ResponseHandler] Resposta via: ENCERRAMENTO');
            return { type: 'response', text: this.getClosingResponse() };
        }

        // 8. Pergunta desconhecida - encaminha ao admin
        console.log('[ResponseHandler] Pergunta DESCONHECIDA - Encaminhar ao admin');
        return {
            type: 'unknown',
            question: message,
            clientInfo: clientInfo
        };
    }

    /**
     * Usa Gemini para buscar pergunta semanticamente similar nas respostas aprendidas
     * e valida se a resposta ainda faz sentido
     */
    async findSemanticMatch(userQuestion) {
        const learnedList = learningService.getAllLearnedQuestions();

        if (!learnedList || learnedList.length === 0) {
            return null;
        }

        // Monta lista de perguntas para Gemini analisar
        const questionsText = learnedList.map((q, i) => `${i + 1}. ${q.question}`).join('\n');

        const prompt = `Você é um analisador de perguntas da Silfer Concursos.

PERGUNTA DO CLIENTE:
"${userQuestion}"

PERGUNTAS JÁ RESPONDIDAS:
${questionsText}

TAREFA:
1. Verifique se alguma pergunta da lista é SEMANTICAMENTE IGUAL à pergunta do cliente (mesmo significado, apenas palavras diferentes)
2. NÃO considere perguntas apenas "parecidas" - precisa ser a MESMA pergunta com outras palavras

Responda em JSON:
{
    "found": true ou false,
    "matchIndex": número da pergunta (1, 2, 3...) ou null,
    "confidence": "alta" ou "media" (só use alta se tiver certeza que é a mesma pergunta),
    "reasoning": "explicação curta"
}

Se não encontrar nenhuma pergunta equivalente, responda: {"found": false, "matchIndex": null, "confidence": null, "reasoning": "Não encontrada"}`;

        try {
            const result = await geminiService.generateResponse(prompt);
            const jsonMatch = result.match(/\{[\s\S]*\}/);

            if (!jsonMatch) return null;

            const analysis = JSON.parse(jsonMatch[0]);

            if (!analysis.found || !analysis.matchIndex || analysis.confidence !== 'alta') {
                return null;
            }

            const matchedItem = learnedList[analysis.matchIndex - 1];
            if (!matchedItem) return null;

            // Segunda verificação: a resposta faz sentido para esta pergunta?
            const validatePrompt = `Verifique se a resposta abaixo é APROPRIADA para a pergunta do cliente.

PERGUNTA DO CLIENTE: "${userQuestion}"
RESPOSTA DISPONÍVEL: "${matchedItem.answer}"

A resposta atende a pergunta do cliente? Responda em JSON:
{
    "isValid": true ou false,
    "issue": "descrição do problema" (só se isValid=false)
}`;

            const validateResult = await geminiService.generateResponse(validatePrompt);
            const validateMatch = validateResult.match(/\{[\s\S]*\}/);

            if (!validateMatch) return null;

            const validation = JSON.parse(validateMatch[0]);

            if (validation.isValid) {
                console.log(`[SemanticMatch] Encontrada pergunta similar: "${matchedItem.question}"`);
                return {
                    success: true,
                    answer: matchedItem.answer,
                    matchedQuestion: matchedItem.question
                };
            } else {
                // Resposta não serve - notifica Pablo
                console.log(`[SemanticMatch] Resposta não adequada: ${validation.issue}`);
                return {
                    success: false,
                    issue: validation.issue,
                    matchedQuestion: matchedItem.question,
                    matchedAnswer: matchedItem.answer,
                    notifyAdmin: true
                };
            }

        } catch (error) {
            console.log('[SemanticMatch] Erro:', error.message);
            return null;
        }
    }

    /**
     * Formata resposta do admin usando Gemini
     */
    async formatAdminResponse(rawAnswer, question) {
        const prompt = `Você é o assistente da Silfer Concursos.
Formate a seguinte resposta de forma profissional e amigável, usando emojis moderadamente.

FORMATAÇÃO WHATSAPP (use apenas quando apropriado):
- *negrito* = UM asterisco (ex: *texto*) - NÃO use ** que é Markdown
- _itálico_ = underlines (ex: _texto_)
- ~tachado~ = tils (ex: ~texto~)
- \`\`\`mono\`\`\` = 3 crases (ex: \`\`\`código\`\`\`)

Ao final, adicione: "_Digite *MENU* para ver as opções._"

Pergunta original do cliente: "${question}"
Resposta do admin: "${rawAnswer}"

Formatar agora:`;

        try {
            const formatted = await geminiService.generateResponse(prompt);
            return formatted;
        } catch {
            return rawAnswer + '\n\n_Digite *MENU* para ver as opções._';
        }
    }

    /**
     * Analisa mensagem desconhecida com Gemini
     */
    async analyzeUnknownMessage(message, conversationHistory, userName) {
        const knowledgeBase = this.getKnowledgeBaseSummary();

        const prompt = `Você é o assistente virtual da Silfer Concursos, especializado em cursos preparatórios para o concurso da PMERJ 2026 em Nova Iguaçu/RJ.

BASE DE CONHECIMENTO:
${knowledgeBase}

HISTÓRICO DA CONVERSA:
${conversationHistory || 'Sem histórico anterior.'}

MENSAGEM DO CLIENTE (${userName}):
"${message}"

ANALISE e decida UMA opção:

1. CLARIFY - Mensagem incompleta/fragmentada ("ok", "sim", "e aí?")
2. REJECT - Fora do escopo (não relacionada a cursos/concursos)
3. ANSWER - Você consegue responder COM CERTEZA com as informações acima
4. FORWARD - Pergunta legítima mas você NÃO tem certeza da resposta

RESPONDA em JSON:
{
  "action": "CLARIFY" ou "REJECT" ou "ANSWER" ou "FORWARD",
  "response": "Resposta para o cliente (se não for FORWARD)",
  "contextualizedQuestion": "Pergunta reformulada (se FORWARD)"
}

Use emojis e formatação WhatsApp (LEMBRE: negrito é *um asterisco*, não **dois**). Seja educado e profissional.`;

        try {
            const result = await geminiService.generateResponse(prompt);
            const jsonMatch = result.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                return {
                    action: parsed.action?.toLowerCase() || 'forward',
                    response: parsed.response || '',
                    contextualizedQuestion: parsed.contextualizedQuestion || message
                };
            }
        } catch (error) {
            console.log('[ResponseHandler] Erro Gemini:', error.message);
        }

        return {
            action: 'forward',
            response: '',
            contextualizedQuestion: message
        };
    }

    /**
     * Gera resumo da base de conhecimento
     */
    getKnowledgeBaseSummary() {
        const info = [];
        const empresa = this.respostas.empresa || {};
        const turmas = this.respostas.turmas || {};
        const investimento = this.respostas.investimento || {};

        info.push(`Empresa: ${empresa.nome || 'Silfer Concursos'}`);
        info.push(`Local: ${empresa.local || ''}`);
        info.push(`Endereço: ${empresa.endereco || ''}`);
        info.push(`WhatsApp: ${empresa.whatsapp || ''}`);
        info.push(`Concurso: ${this.respostas.concurso_atual?.nome || 'PMERJ 2026'}`);

        if (turmas.semanal) {
            info.push(`\nTurma Semanal: ${turmas.semanal.dias} - ${turmas.semanal.horario} - Início ${turmas.semanal.inicio}`);
        }
        if (turmas.sabado) {
            info.push(`Turma Sábados: ${turmas.sabado.dias} - ${turmas.sabado.horario} - Início ${turmas.sabado.inicio}`);
        }

        info.push(`\nInvestimento: ${investimento.parcelamento || ''}`);
        info.push(`Matrícula: ${investimento.matricula || ''}`);
        info.push(`Formulário: ${empresa.formulario || ''}`);

        // Respostas aprendidas
        const learned = this.respostas.respostas_aprendidas || {};
        const learnedCount = Object.keys(learned).length;
        if (learnedCount > 0) {
            info.push(`\nRespostas aprendidas: ${learnedCount}`);
            for (const [q, a] of Object.entries(learned)) {
                info.push(`- ${q}: ${a.substring(0, 80)}...`);
            }
        }

        return info.join('\n');
    }

    /**
     * Salva resposta aprendida no JSON
     */
    saveLearnedResponse(question, answer) {
        if (!this.respostas.respostas_aprendidas) {
            this.respostas.respostas_aprendidas = {};
        }
        this.respostas.respostas_aprendidas[question] = answer;

        try {
            fs.writeFileSync(RESPOSTAS_FILE, JSON.stringify(this.respostas, null, 2), 'utf-8');
            console.log(`[ResponseHandler] Resposta salva no JSON: "${question}"`);
            return true;
        } catch (err) {
            console.error('[ResponseHandler] Erro ao salvar:', err.message);
            return false;
        }
    }
}

module.exports = new ResponseHandler();

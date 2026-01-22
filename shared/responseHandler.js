/**
 * Handler de respostas híbrido
 * Verifica JSON local → Respostas aprendidas → Encaminha ao admin
 * 
 * NÃO usa mais Gemini para inventar respostas!
 */

const respostas = require('./respostas.json');
const learningService = require('./learningService');
const geminiService = require('./geminiService');

class ResponseHandler {
    constructor() {
        this.respostas = respostas;
        this.empresa = respostas.empresa || {};
    }

    /**
     * Recarrega respostas do arquivo (para pegar atualizações)
     */
    reloadRespostas() {
        delete require.cache[require.resolve('./respostas.json')];
        this.respostas = require('./respostas.json');
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
     * Verifica se uma palavra-chave existe como palavra inteira no texto
     * (Evita 'carnaval' dar match em 'naval')
     */
    containsWholeWord(text, keyword) {
        const normalizedText = this.normalizeText(text);
        const normalizedKeyword = this.normalizeText(keyword);

        // Keywords curtas (<=3 chars) precisam ser palavra exata
        if (normalizedKeyword.length <= 3) {
            const words = normalizedText.split(/\s+/);
            return words.includes(normalizedKeyword);
        }

        // Keywords maiores, verifica como palavra inteira usando regex
        const regex = new RegExp(`\\b${normalizedKeyword}\\b`, 'i');
        return regex.test(normalizedText);
    }

    /**
     * Verifica se a mensagem corresponde ao menu
     */
    checkMenu(message) {
        const normalized = this.normalizeText(message);
        const menuTriggers = this.respostas.menu.trigger.map(t => this.normalizeText(t));

        if (menuTriggers.some(trigger => normalized.includes(trigger) || trigger.includes(normalized))) {
            return this.respostas.menu.response;
        }
        return null;
    }

    /**
     * Verifica opção numérica
     */
    checkNumericOption(message) {
        const trimmed = message.trim();
        if (this.respostas.options[trimmed]) {
            return this.respostas.options[trimmed].response;
        }
        return null;
    }

    /**
     * Verifica palavras-chave das opções
     */
    checkOptionKeywords(message) {
        const normalized = this.normalizeText(message);

        for (const [optionKey, optionData] of Object.entries(this.respostas.options)) {
            if (optionData.keywords) {
                for (const keyword of optionData.keywords) {
                    if (this.containsWholeWord(message, keyword)) {
                        return optionData.response;
                    }
                }
            }
        }
        return null;
    }

    /**
     * Verifica palavras-chave gerais
     */
    checkGeneralKeywords(message) {
        const normalized = this.normalizeText(message);

        for (const [keyword, response] of Object.entries(this.respostas.keywords)) {
            if (this.containsWholeWord(message, keyword)) {
                return response;
            }
        }
        return null;
    }

    /**
     * Verifica respostas aprendidas do admin
     */
    checkLearnedResponses(message) {
        return learningService.findLearnedResponse(message);
    }

    /**
     * Processa mensagem e retorna resposta
     * 
     * Retorna:
     * - { type: 'response', text: '...' } para respostas normais
     * - { type: 'unknown', question: '...' } para perguntas desconhecidas
     */
    async processMessage(message, clientInfo = {}) {
        if (!message || typeof message !== 'string') {
            return null;
        }

        console.log(`[ResponseHandler] Processando: "${message}"`);

        // 1. Verifica opção numérica (prioridade máxima - é intencional)
        let response = this.checkNumericOption(message);
        if (response) {
            console.log('[ResponseHandler] Resposta via: OPÇÃO NUMÉRICA');
            return { type: 'response', text: response };
        }

        // 2. Verifica respostas APRENDIDAS (antes de tudo, são específicas!)
        response = this.checkLearnedResponses(message);
        if (response) {
            console.log('[ResponseHandler] Resposta via: APRENDIDA');
            return { type: 'response', text: response };
        }

        // 3. Verifica palavras-chave das opções
        response = this.checkOptionKeywords(message);
        if (response) {
            console.log('[ResponseHandler] Resposta via: KEYWORD OPÇÃO');
            return { type: 'response', text: response };
        }

        // 4. Verifica palavras-chave gerais
        response = this.checkGeneralKeywords(message);
        if (response) {
            console.log('[ResponseHandler] Resposta via: KEYWORD GERAL');
            return { type: 'response', text: response };
        }

        // 5. Verifica menu (por último entre conhecidos - saudações genéricas)
        response = this.checkMenu(message);
        if (response) {
            console.log('[ResponseHandler] Resposta via: MENU');
            return { type: 'response', text: response };
        }

        // 6. Pergunta desconhecida - NÃO usa Gemini para inventar!
        console.log('[ResponseHandler] Pergunta DESCONHECIDA - Encaminhar ao admin');
        return {
            type: 'unknown',
            question: message,
            clientInfo: clientInfo
        };
    }

    /**
     * Formata resposta do admin usando Gemini
     */
    async formatAdminResponse(rawAnswer, question) {
        const prompt = `Você é o assistente da Silfer Concursos.
Formate a seguinte resposta de forma profissional e amigável, usando emojis moderadamente.
Use formatação WhatsApp (*negrito* e _itálico_).
Ao final, adicione: "_Digite *MENU* para voltar ao início._"

Pergunta original do cliente: "${question}"
Resposta do admin: "${rawAnswer}"

Formatar agora:`;

        try {
            const formatted = await geminiService.generateResponse(prompt);
            return formatted;
        } catch {
            return rawAnswer + '\n\n_Digite *MENU* para voltar ao início._';
        }
    }

    /**
     * Analisa mensagem desconhecida com Gemini antes de encaminhar
     * 
     * Retorna:
     * - { action: 'clarify', response: '...' } - Pede esclarecimento
     * - { action: 'reject', response: '...' } - Recusa educadamente  
     * - { action: 'answer', response: '...' } - Gemini responde diretamente
     * - { action: 'forward', contextualizedQuestion: '...' } - Encaminha ao admin
     */
    async analyzeUnknownMessage(message, conversationHistory, userName) {
        // Carrega base de conhecimento para contexto
        const knowledgeBase = this.getKnowledgeBaseSummary();

        const prompt = `Você é o assistente virtual da Silfer Concursos, especializado em cursos preparatórios para concursos militares (PMERJ, CBMERJ, etc.) em Nova Iguaçu/RJ.

BASE DE CONHECIMENTO DA SILFER:
${knowledgeBase}

HISTÓRICO DA CONVERSA:
${conversationHistory || 'Sem histórico anterior.'}

NOVA MENSAGEM DO CLIENTE (${userName}):
"${message}"

ANALISE esta mensagem e decida UMA das opções:

1. CLARIFY - Se a mensagem é incompleta, sem sentido, fragmentada ou incompreensível.
   Exemplos: "não vai", "ok", "hm", "e aí?", "sim", "pode ser", frases soltas

2. REJECT - Se é uma pergunta fora do escopo (não relacionada a cursos/concursos).
   Exemplos: "quanto é 1+1?", "qual o clima amanhã?", "me conta uma piada"

3. ANSWER - Se você consegue responder COM CERTEZA usando as informações da base de conhecimento.
   Você pode inferir respostas (se A=B e A=C, então B=C).
   Use esta opção se tiver certeza da resposta.

4. FORWARD - Se é uma pergunta legítima mas você NÃO tem certeza da resposta.
   Neste caso, reformule a pergunta com contexto para o admin entender.

RESPONDA EXATAMENTE neste formato JSON:
{
  "action": "CLARIFY" ou "REJECT" ou "ANSWER" ou "FORWARD",
  "response": "Resposta para o cliente (se CLARIFY, REJECT ou ANSWER)",
  "contextualizedQuestion": "Pergunta reformulada com contexto (se FORWARD)"
}

IMPORTANTE: 
- Use emojis moderadamente
- Use formatação WhatsApp (*negrito* e _itálico_)
- Seja educado e profissional
- Ao final das respostas, adicione: "_Digite *MENU* para voltar ao início._"
- Prefira ANSWER se tiver certeza, só use FORWARD se realmente não souber`;

        try {
            const result = await geminiService.generateResponse(prompt);

            // Tenta parsear o JSON
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
            console.log('[ResponseHandler] Erro ao analisar com Gemini:', error.message);
        }

        // Fallback: encaminha normalmente
        return {
            action: 'forward',
            response: '',
            contextualizedQuestion: message
        };
    }

    /**
     * Gera resumo da base de conhecimento para o Gemini
     */
    getKnowledgeBaseSummary() {
        const info = [];

        // Informações da empresa
        const empresa = this.respostas.empresa || {};
        info.push(`Empresa: ${empresa.nome || 'Silfer Concursos'}`);
        info.push(`Slogan: ${empresa.slogan || 'Nossa Missão: Sua Aprovação!'}`);
        info.push(`Endereço: ${empresa.endereco || 'Nova Iguaçu, RJ'}`);
        info.push(`Telefone: ${empresa.telefone || '(24) 99924-2217'}`);
        info.push(`Site: ${empresa.site || 'silferconcursos.com.br'}`);

        // Cursos disponíveis
        info.push('\nCursos: PMERJ (Soldado PM), CBMERJ (Soldado Bombeiro)');
        info.push('Modalidades: Online (Hotmart) e Presencial');
        info.push('Pagamento: Cartão (12x), Boleto, PIX');

        // Horários
        info.push('\nHorário: Seg-Sex 08h-21h, Sáb 08h-12h, Dom fechado');

        // Respostas aprendidas
        const learned = learningService.learnedResponses?.responses || [];
        if (learned.length > 0) {
            info.push('\nInformações aprendidas:');
            learned.forEach(r => {
                info.push(`- ${r.question}: ${r.answer.substring(0, 100)}...`);
            });
        }

        return info.join('\n');
    }
}

module.exports = new ResponseHandler();

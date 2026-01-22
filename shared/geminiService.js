/**
 * Serviço de integração com Gemini API
 * Implementa sistema round-robin para rodízio de chaves
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const path = require('path');
const respostas = require('./respostas.json');

class GeminiService {
    constructor() {
        this.apiKeys = [];
        this.currentKeyIndex = 0;
        this.clients = [];
        this.loadApiKeys();
    }

    /**
     * Carrega todas as chaves de API do ambiente
     */
    loadApiKeys() {
        let keyIndex = 1;
        while (process.env[`GEMINI_API_KEY_${keyIndex}`]) {
            const key = process.env[`GEMINI_API_KEY_${keyIndex}`];
            this.apiKeys.push(key);
            this.clients.push(new GoogleGenerativeAI(key));
            keyIndex++;
        }

        // Fallback para chave única sem número
        if (this.apiKeys.length === 0 && process.env.GEMINI_API_KEY) {
            this.apiKeys.push(process.env.GEMINI_API_KEY);
            this.clients.push(new GoogleGenerativeAI(process.env.GEMINI_API_KEY));
        }

        if (this.apiKeys.length === 0) {
            console.warn('[GeminiService] Nenhuma chave de API encontrada. Configure GEMINI_API_KEY_1, GEMINI_API_KEY_2, etc.');
        } else {
            console.log(`[GeminiService] ${this.apiKeys.length} chave(s) de API carregada(s)`);
        }
    }

    /**
     * Obtém o próximo cliente usando round-robin
     */
    getNextClient() {
        if (this.clients.length === 0) {
            throw new Error('Nenhuma chave de API configurada');
        }

        const client = this.clients[this.currentKeyIndex];
        this.currentKeyIndex = (this.currentKeyIndex + 1) % this.clients.length;

        console.log(`[GeminiService] Usando chave ${this.currentKeyIndex + 1} de ${this.clients.length}`);
        return client;
    }

    /**
     * Gera resposta usando Gemini API
     * @param {string} userMessage - Mensagem do usuário
     * @returns {Promise<string>} - Resposta gerada
     */
    async generateResponse(userMessage) {
        try {
            const client = this.getNextClient();
            const model = client.getGenerativeModel({ model: 'gemini-2.5-flash' });

            const systemPrompt = respostas.systemPrompt ||
                'Você é o assistente virtual da Silfer Concursos. Responda de forma profissional e direta.';

            const prompt = `${systemPrompt}\n\nMensagem do cliente: ${userMessage}`;

            const result = await model.generateContent(prompt);
            const response = await result.response;
            const text = response.text();

            return text;
        } catch (error) {
            console.error('[GeminiService] Erro ao gerar resposta:', error.message);

            // Se for erro de quota, tenta próxima chave
            if (error.message.includes('quota') || error.message.includes('429')) {
                console.log('[GeminiService] Quota excedida, tentando próxima chave...');
                return this.generateResponse(userMessage);
            }

            return 'Desculpe, não foi possível processar sua mensagem no momento. Por favor, tente novamente em alguns instantes ou digite MENU para ver as opções disponíveis.';
        }
    }
}

module.exports = new GeminiService();

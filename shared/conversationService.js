/**
 * Conversation Service - Gerencia histórico de conversas
 * 
 * Mantém as últimas mensagens de cada usuário para contexto.
 */

// Histórico de conversas por número
const conversationHistory = new Map();
const MAX_HISTORY = 5;

class ConversationService {
    /**
     * Adiciona mensagem ao histórico
     */
    addMessage(phoneNumber, role, content) {
        if (!conversationHistory.has(phoneNumber)) {
            conversationHistory.set(phoneNumber, []);
        }

        const history = conversationHistory.get(phoneNumber);
        history.push({
            role: role, // 'user' ou 'bot'
            content: content,
            timestamp: new Date().toISOString()
        });

        // Mantém apenas as últimas MAX_HISTORY mensagens
        if (history.length > MAX_HISTORY) {
            history.shift();
        }
    }

    /**
     * Obtém histórico formatado para contexto
     */
    getHistory(phoneNumber) {
        const history = conversationHistory.get(phoneNumber) || [];
        return history;
    }

    /**
     * Obtém histórico como texto para o Gemini
     */
    getHistoryAsText(phoneNumber) {
        const history = this.getHistory(phoneNumber);
        if (history.length === 0) return "Sem histórico anterior.";

        return history.map(msg => {
            const role = msg.role === 'user' ? 'Cliente' : 'Bot';
            return `${role}: ${msg.content}`;
        }).join('\n');
    }

    /**
     * Limpa histórico de um usuário
     */
    clearHistory(phoneNumber) {
        conversationHistory.delete(phoneNumber);
    }
}

module.exports = new ConversationService();

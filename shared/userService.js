/**
 * User Service - Sistema de Memória de Usuários
 * 
 * Gerencia identificação e armazenamento de nomes de clientes.
 */

const fs = require('fs');
const path = require('path');

const USERS_FILE = path.join(__dirname, 'usersDatabase.json');

// Estados de conversa para cada usuário
const conversationStates = new Map();

class UserService {
    constructor() {
        this.users = this.loadUsers();
        // Limpa usuários inativos há mais de 30 dias na inicialização
        this.cleanupInactiveUsers(30);
    }

    loadUsers() {
        try {
            const data = fs.readFileSync(USERS_FILE, 'utf-8');
            return JSON.parse(data);
        } catch {
            return { users: {} };
        }
    }

    save() {
        fs.writeFileSync(USERS_FILE, JSON.stringify(this.users, null, 2), 'utf-8');
    }

    // ==========================================
    // GERENCIAMENTO DE USUÁRIOS
    // ==========================================

    /**
     * Verifica se usuário está cadastrado
     */
    isKnownUser(phoneNumber) {
        return !!this.users.users[phoneNumber];
    }

    /**
     * Obtém nome do usuário
     */
    getUserName(phoneNumber) {
        const user = this.users.users[phoneNumber];
        return user ? user.name : null;
    }

    /**
     * Obtém todos os dados do usuário
     */
    getUserData(phoneNumber) {
        return this.users.users[phoneNumber] || null;
    }

    /**
     * Salva usuário com nome confirmado
     */
    saveUser(phoneNumber, name, whatsappName = null) {
        const existingData = this.users.users[phoneNumber] || {};
        this.users.users[phoneNumber] = {
            ...existingData,
            name: name,
            whatsappName: whatsappName,
            confirmedAt: existingData.confirmedAt || new Date().toISOString(),
            lastInteraction: new Date().toISOString()
        };
        this.save();
        console.log(`[UserService] Usuário salvo: ${phoneNumber} → ${name}`);
    }

    /**
     * Atualiza dados adicionais do usuário (email, interesses, notas)
     */
    updateUserData(phoneNumber, data) {
        if (!this.users.users[phoneNumber]) {
            this.users.users[phoneNumber] = {};
        }

        this.users.users[phoneNumber] = {
            ...this.users.users[phoneNumber],
            ...data,
            lastInteraction: new Date().toISOString()
        };
        this.save();
        console.log(`[UserService] Dados atualizados para: ${phoneNumber}`);
    }

    /**
     * Atualiza última interação do usuário
     */
    updateLastInteraction(phoneNumber) {
        if (this.users.users[phoneNumber]) {
            this.users.users[phoneNumber].lastInteraction = new Date().toISOString();
            this.save();
        }
    }

    /**
     * Remove usuários inativos há mais de X dias
     */
    cleanupInactiveUsers(days = 30) {
        const now = Date.now();
        const maxAge = days * 24 * 60 * 60 * 1000; // dias em ms
        let removed = 0;

        for (const phone in this.users.users) {
            const user = this.users.users[phone];
            const lastInteraction = user.lastInteraction ? new Date(user.lastInteraction).getTime() : 0;

            if (now - lastInteraction > maxAge) {
                delete this.users.users[phone];
                removed++;
            }
        }

        if (removed > 0) {
            this.save();
            console.log(`[UserService] Limpeza: ${removed} usuário(s) inativo(s) há +${days} dias removido(s)`);
        }
    }

    /**
     * Atualiza nome do usuário
     */
    updateName(phoneNumber, newName) {
        if (this.users.users[phoneNumber]) {
            this.users.users[phoneNumber].name = newName;
            this.users.users[phoneNumber].updatedAt = new Date().toISOString();
            this.save();
            console.log(`[UserService] Nome atualizado: ${phoneNumber} → ${newName}`);
            return true;
        }
        return false;
    }

    /**
     * Gera resumo do perfil do usuário para contexto do Gemini
     * (Privado - só dados desse usuário específico)
     */
    getContextForGemini(phoneNumber) {
        const user = this.users.users[phoneNumber];
        if (!user) return 'Usuário novo, ainda não temos informações sobre ele.';

        const contextParts = [];

        contextParts.push(`Nome: ${user.name || 'Não informado'}`);

        if (user.email) {
            contextParts.push(`Email: ${user.email}`);
        }

        if (user.cursosInteresse) {
            contextParts.push(`Cursos de interesse: ${user.cursosInteresse}`);
        }

        if (user.concursoAlvo) {
            contextParts.push(`Concurso alvo: ${user.concursoAlvo}`);
        }

        if (user.notas) {
            contextParts.push(`Observações: ${user.notas}`);
        }

        if (user.confirmedAt) {
            const dataRegistro = new Date(user.confirmedAt).toLocaleDateString('pt-BR');
            contextParts.push(`Cliente desde: ${dataRegistro}`);
        }

        return contextParts.join('\n');
    }

    // ==========================================
    // ESTADOS DE CONVERSA
    // ==========================================

    /**
     * Define estado da conversa
     * Estados: null, 'awaiting_name_confirmation', 'awaiting_name_input'
     */
    setState(phoneNumber, state, data = {}) {
        conversationStates.set(phoneNumber, { state, data, timestamp: Date.now() });
    }

    /**
     * Obtém estado da conversa
     */
    getState(phoneNumber) {
        const entry = conversationStates.get(phoneNumber);
        if (!entry) return null;

        // Expira estados após 5 minutos
        if (Date.now() - entry.timestamp > 5 * 60 * 1000) {
            conversationStates.delete(phoneNumber);
            return null;
        }

        return entry;
    }

    /**
     * Limpa estado da conversa
     */
    clearState(phoneNumber) {
        conversationStates.delete(phoneNumber);
    }

    // ==========================================
    // MENSAGENS
    // ==========================================

    /**
     * Retorna saudação baseada no horário
     */
    getGreeting() {
        const hour = new Date().getHours();
        if (hour >= 5 && hour < 12) return 'Bom dia';
        if (hour >= 12 && hour < 18) return 'Boa tarde';
        return 'Boa noite';
    }

    getNameConfirmationMessage(whatsappName) {
        const greeting = this.getGreeting();
        return `👋 ${greeting}! Tudo bem?\n\n` +
            `Posso te chamar de *${whatsappName}*? 🤔\n\n` +
            `Responda *SIM* ou *NÃO*`;
    }

    getAskNameMessage() {
        return `😊 Tranquilo! Como prefere que eu te chame?`;
    }

    /**
     * Retorna mensagem de boas-vindas do JSON
     * Substitui {nome} e {saudacao} dinamicamente
     */
    getWelcomeMessage(name) {
        try {
            const responseHandler = require('./responseHandler');
            let msg = responseHandler.getWelcomeMessage();
            const saudacao = this.getGreeting();
            msg = msg.replace('{nome}', name || 'Cliente');
            msg = msg.replace('{saudacao}', saudacao);
            return msg;
        } catch {
            const saudacao = this.getGreeting();
            return `*Olá, ${name || 'Cliente'}! ${saudacao}! Bem-vindo(a) à SILFER CONCURSOS!* 👮‍♂️\n\nDigite *MENU* para ver as opções.`;
        }
    }

    /**
     * Retorna menu principal
     */
    getMenuMessage() {
        try {
            const responseHandler = require('./responseHandler');
            return responseHandler.getMenuMessage();
        } catch {
            return 'Digite *MENU* para ver as opções.';
        }
    }

    getNameChangedMessage(newName) {
        return `✅ Pronto! A partir de agora vou te chamar de *${newName}*! 😊\n\n` +
            `_Digite *MENU* para ver as opções._`;
    }

    /**
     * Mensagem de retorno para usuário conhecido
     */
    getReturningUserMessage(name) {
        const greeting = this.getGreeting();
        return `👋 *${greeting}, ${name}!* Que bom te ver de novo! 😊\n\n` +
            `Como posso ajudar hoje?\n\n` +
            `*1* - 💻 Cursos Online\n` +
            `*2* - 🏫 Cursos Presenciais\n` +
            `*3* - 🕐 Horário de Funcionamento\n` +
            `*4* - 📍 Localização\n` +
            `*5* - 👨‍🏫 Nossos Professores\n` +
            `*6* - 💬 Falar com Atendente`;
    }

    // ==========================================
    // DETECÇÃO DE PEDIDOS
    // ==========================================

    /**
     * Verifica se usuário quer mudar o nome
     * Retorna o novo nome ou null
     */
    detectNameChangeRequest(message) {
        const msg = message.toLowerCase();

        // Padrões para detectar pedido de mudança de nome
        const patterns = [
            /me\s+chame?\s+de\s+(.+)/i,
            /meu\s+nome\s+(?:é|e)\s+(.+)/i,
            /pode\s+me\s+chamar\s+de\s+(.+)/i,
            /quero\s+ser\s+chamad[oa]\s+de\s+(.+)/i,
            /trocar?\s+(?:meu\s+)?nome\s+(?:para\s+)?(.+)/i,
            /mudar?\s+(?:meu\s+)?nome\s+(?:para\s+)?(.+)/i,
            /alterar?\s+(?:meu\s+)?nome\s+(?:para\s+)?(.+)/i
        ];

        for (const pattern of patterns) {
            const match = message.match(pattern);
            if (match && match[1]) {
                // Limpa o nome extraído
                let newName = match[1].trim()
                    .replace(/[.!?]+$/, '')
                    .replace(/^["']|["']$/g, '');

                if (newName.length > 1 && newName.length < 50) {
                    return newName;
                }
            }
        }

        // Detecta apenas intenção de mudar (sem nome específico)
        if (/(mudar|trocar|alterar)\s+(meu\s+)?nome/i.test(msg)) {
            return 'ASK_NEW_NAME';
        }

        return null;
    }

    /**
     * Verifica se é resposta positiva
     */
    isPositiveResponse(message) {
        const positives = ['sim', 'ss', 'sss', 'isso', 'exato', 'correto', 'sou', 'é isso', 'e isso', 'isso mesmo', 'sou eu', 'sou sim', 'yes', 'yeah', 's'];
        return positives.includes(message.toLowerCase().trim());
    }

    /**
     * Verifica se é resposta negativa
     */
    isNegativeResponse(message) {
        const negatives = ['não', 'nao', 'n', 'nn', 'nope', 'no', 'negativo', 'errado', 'não sou', 'nao sou'];
        return negatives.includes(message.toLowerCase().trim());
    }
}

module.exports = new UserService();

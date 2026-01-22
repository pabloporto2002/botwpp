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
     * Salva usuário com nome confirmado
     */
    saveUser(phoneNumber, name, whatsappName = null) {
        this.users.users[phoneNumber] = {
            name: name,
            whatsappName: whatsappName,
            confirmedAt: new Date().toISOString()
        };
        this.save();
        console.log(`[UserService] Usuário salvo: ${phoneNumber} → ${name}`);
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

    getNameConfirmationMessage(whatsappName) {
        return `👋 Olá! Antes de começarmos...\n\n` +
            `Estou falando com *${whatsappName}*? 🤔\n\n` +
            `Responda *SIM* ou *NÃO*`;
    }

    getAskNameMessage() {
        return `😊 Sem problemas! Como posso te chamar?`;
    }

    getWelcomeMessage(name) {
        return `✨ Prazer em conhecer você, *${name}*!\n\n` +
            `A partir de agora vou me lembrar de você! 💾\n\n` +
            `━━━━━━━━━━━━━━━\n\n` +
            `👋 *Olá, ${name}! Bem-vindo à Silfer Concursos!*\n\n` +
            `🎯 _Nossa Missão: Sua Aprovação!_\n\n` +
            `Como posso ajudar?\n\n` +
            `*1* - 💻 Cursos Online\n` +
            `*2* - 🏫 Cursos Presenciais\n` +
            `*3* - 🕐 Horário de Funcionamento\n` +
            `*4* - 📍 Localização\n` +
            `*5* - 👨‍🏫 Nossos Professores\n` +
            `*6* - 💬 Falar com Atendente`;
    }

    getNameChangedMessage(newName) {
        return `✅ Pronto! A partir de agora vou te chamar de *${newName}*! 😊\n\n` +
            `_Digite *MENU* para ver as opções._`;
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

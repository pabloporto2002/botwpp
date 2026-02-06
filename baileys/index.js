/**
 * Bot WhatsApp - Silfer Concursos
 * Versão: Baileys com Sistema de Aprendizado
 * 
 * - Responde com base em JSON local e respostas aprendidas
 * - Encaminha perguntas desconhecidas ao admin
 * - Aprende novas respostas quando admin responde
 */

require('dotenv').config({ path: '../.env' });
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const qrcode = require('qrcode');
const pino = require('pino');
const fs = require('fs');
const { exec } = require('child_process');
const responseHandler = require('../shared/responseHandler');
const learningService = require('../shared/learningService');
const userService = require('../shared/userService');
const conversationService = require('../shared/conversationService');

const sessionName = process.env.SESSION_NAME || 'silfer-bot';
const authFolder = `./auth_${sessionName}`;
const qrFile = 'qrcode.jpg';

const logger = pino({ level: 'silent' });

// Silencia logs internos do Baileys (buffers, crypto keys, etc)
const originalConsoleLog = console.log;
console.log = (...args) => {
    const msg = args.join(' ');
    // Ignora logs que contêm dados de criptografia/buffers/sessões
    if (msg.includes('<Buffer') ||
        msg.includes('privKey') ||
        msg.includes('baseKey') ||
        msg.includes('chainKey') ||
        msg.includes('preKeyId') ||
        msg.includes('signedKeyId') ||
        msg.includes('SessionEntry') ||
        msg.includes('_chains') ||
        msg.includes('closed session') ||
        msg.includes('Closing session') ||
        msg.includes('indexInfo') ||
        msg.includes('pendingPreKey') ||
        msg.includes('registrationId') ||
        msg.includes('currentRatchet') ||
        msg.includes('ephemeralKeyPair') ||
        msg.includes('pubKey') ||
        msg.includes('rootKey') ||
        msg.includes('previousCounter') ||
        msg.includes('lastRemoteEphemeral') ||
        msg.includes('messageKeys') ||
        msg.includes('chainType')) {
        return; // Não imprime
    }
    originalConsoleLog.apply(console, args);
};

let sock = null;

// Sistema de Follow-up (lembrete após inatividade)
const FOLLOW_UP_DELAY_MS = 5 * 60 * 1000; // 5 minutos
const followUpTimers = new Map(); // Rastreia timers por número

// Sistema de Takeover Humano - quando admin responde, bot para de responder por 5 min
const HUMAN_TAKEOVER_MS = 5 * 60 * 1000; // 5 minutos
const humanTakeovers = new Map(); // Rastreia quando admin assumiu conversa com cliente

/**
 * Verifica se uma conversa está em modo humano (admin respondeu recentemente)
 */
function isHumanTakeover(jid) {
    if (!humanTakeovers.has(jid)) return false;
    const lastHumanMsg = humanTakeovers.get(jid);
    const elapsed = Date.now() - lastHumanMsg;
    if (elapsed > HUMAN_TAKEOVER_MS) {
        humanTakeovers.delete(jid);
        return false;
    }
    return true;
}

/**
 * Marca que um humano assumiu a conversa com um cliente
 */
function setHumanTakeover(clientJid) {
    humanTakeovers.set(clientJid, Date.now());
    console.log(`[Takeover] Admin assumiu conversa com ${clientJid.split('@')[0]} por 5 min`);
}

// Frases motivacionais para quem demora a responder
const FRASES_MOTIVACIONAIS = [
    "💪 *Lembre-se:* A farda é o primeiro passo para mudar sua história!",
    "🎯 *Foco no objetivo!* Sua aprovação está mais perto do que você imagina.",
    "💰 *Estabilidade financeira* e uma carreira respeitada te esperam. Não desista!",
    "👮 *Ser PM* é mais que uma profissão, é uma missão. Você consegue!",
    "📈 *Chega de sofrer com contas!* A carreira militar te dá segurança.",
    "🔥 *A dor do treino é temporária, a glória é para sempre!*",
    "🌟 *Acredite:* Milhares já conseguiram e você será o próximo!",
    "💼 *Estabilidade, respeito e uma carreira sólida.* Isso te espera!",
    "🏆 *Não deixe o medo te parar.* A farda será sua conquista!",
    "⭐ *Sua família merece ver você de farda!* Dê esse orgulho a eles."
];

// Rastreia contexto da última mensagem para cada cliente (menu, turma, etc)
const followUpContext = new Map();

// Opções por tipo de mensagem
const OPCOES = {
    menu: `*1* - 🕒 Escolha a sua Turma
*2* - 📍 Localização
*3* - 💳 Investimento e Matrícula
*4* - 💬 Falar com Atendente`,
    turma: `*1* - Turma Semanal (Noite)
*2* - Turma aos Sábados`
};

/**
 * Salva contexto de qual mensagem foi a última enviada
 */
function setFollowUpContext(jid, type, userName) {
    followUpContext.set(jid, { type, userName });
}

/**
 * Gera mensagem de follow-up contextual
 */
function getFollowUpMessage(jid) {
    const frase = FRASES_MOTIVACIONAIS[Math.floor(Math.random() * FRASES_MOTIVACIONAIS.length)];
    const context = followUpContext.get(jid) || { type: 'menu', userName: '' };
    const nome = context.userName || '';
    const opcoes = OPCOES[context.type] || OPCOES.menu;

    return `👋 *Oi${nome ? ', ' + nome : ''}! Ainda está por aí?*

Notei que você não respondeu. Posso ajudar em algo?

Se precisar, é só escolher uma opção:

${opcoes}

_Ou digite sua dúvida!_

> ${frase}`;
}

/**
 * Inicia timer de follow-up para um cliente
 * @param {string} jid - JID do cliente
 * @param {string} type - Tipo de contexto: 'menu' ou 'turma'
 * @param {string} userName - Nome do cliente
 */
function startFollowUpTimer(jid, type = 'menu', userName = '') {
    // Cancela timer anterior se existir
    cancelFollowUpTimer(jid);

    // Salva contexto para usar na mensagem
    setFollowUpContext(jid, type, userName);

    const timer = setTimeout(async () => {
        // Verifica se humano assumiu a conversa antes de enviar
        if (isHumanTakeover(jid)) {
            console.log(`[Follow-up] Cancelado - humano está atendendo ${jid.split('@')[0]}`);
            followUpTimers.delete(jid);
            followUpContext.delete(jid);
            return;
        }
        console.log(`[Follow-up] Enviando lembrete motivacional para: ${jid}`);
        await sendMessage(jid, getFollowUpMessage(jid));
        followUpTimers.delete(jid);
        followUpContext.delete(jid);
    }, FOLLOW_UP_DELAY_MS);

    followUpTimers.set(jid, timer);
    console.log(`[Follow-up] Timer iniciado para: ${jid} (5 min) - contexto: ${type}`);
}

/**
 * Cancela timer de follow-up
 */
function cancelFollowUpTimer(jid) {
    if (followUpTimers.has(jid)) {
        clearTimeout(followUpTimers.get(jid));
        followUpTimers.delete(jid);
        console.log(`[Follow-up] Timer cancelado para: ${jid}`);
    }
}

/**
 * Abre o QR Code e rastreia o processo para fechá-lo depois
 */
let qrViewerPid = null;

function openQrCode() {
    const platform = process.platform;

    if (platform === 'win32') {
        // No Windows, usa start /B com cmd para capturar o PID
        const child = exec(`start "" "${qrFile}"`, (error) => {
            if (error) {
                console.error('[Bot] Erro ao abrir QR Code:', error.message);
            } else {
                console.log('[Bot] QR Code aberto na tela.');
            }
        });
        // Tenta rastrear o processo do visualizador de fotos
        setTimeout(() => {
            exec('tasklist /FI "IMAGENAME eq Microsoft.Photos.exe" /FO CSV /NH', (err, stdout) => {
                if (!err && stdout.includes('Microsoft.Photos')) {
                    console.log('[Bot] Visualizador de fotos detectado.');
                }
            });
        }, 2000);
    } else if (platform === 'darwin') {
        exec(`open ${qrFile}`);
    } else {
        exec(`xdg-open ${qrFile}`);
    }
}

/**
 * Fecha o visualizador de QR Code (Windows)
 */
function closeQrViewer() {
    if (process.platform === 'win32') {
        // Fecha o Microsoft Photos se estiver mostrando o QR
        exec('taskkill /IM Microsoft.Photos.exe /F', (err) => {
            if (!err) {
                console.log('[Bot] Visualizador de QR fechado.');
            }
        });
    }
}

/**
 * Remove o arquivo QR e fecha o visualizador
 */
function cleanupQrCode() {
    if (fs.existsSync(qrFile)) {
        try {
            fs.unlinkSync(qrFile);
            console.log('[Bot] Arquivo QR Code removido.');
            closeQrViewer();
        } catch (e) {
            console.error('[Bot] Erro ao remover QR:', e.message);
        }
    }
}

/**
 * Extrai ID de pergunta de uma mensagem citada (para reply-to-message)
 * Procura pelo padrão 🆔 *ID:* xxxxx na mensagem
 */
function extractQuestionIdFromMessage(text) {
    if (!text) return null;
    // Procura padrão: "🆔 *ID:* abc123" ou "ID: abc123"
    const match = text.match(/(?:🆔\s*\*?ID:?\*?\s*|ID:\s*)([a-z0-9]+)/i);
    return match ? match[1] : null;
}

/**
 * Delay helper
 */
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Envia mensagem para um JID com delay para evitar problemas de entrega
 */
async function sendMessage(jid, text) {
    if (!sock) return;

    try {
        // Pequeno delay antes de enviar (300-800ms)
        await delay(300 + Math.random() * 500);

        // Simula "digitando..." para parecer mais humano e dar tempo para sincronizar
        await sock.sendPresenceUpdate('composing', jid);
        await delay(500 + Math.random() * 500);

        // Envia a mensagem
        await sock.sendMessage(jid, { text });

        // Para de "digitar"
        await sock.sendPresenceUpdate('paused', jid);
    } catch (err) {
        console.log(`[Erro] Falha ao enviar msg para ${jid}: ${err.message}`);
    }
}

/**
 * Processa resposta de admin/grupo
 * @param {string} message - Mensagem recebida
 * @param {string} responderJid - JID de quem respondeu
 */
async function processAdminResponse(message, responderJid = null) {
    const parsed = learningService.parseAdminResponse(message);

    if (!parsed) {
        return false;
    }

    const pending = learningService.getPendingById(parsed.id);

    if (!pending) {
        console.log(`[Learning] Pergunta ${parsed.id} não encontrada`);
        const targetJid = responderJid || learningService.getAdminJid();
        await sendMessage(targetJid,
            `⚠️ ID *${parsed.id}* não encontrado nas perguntas pendentes.`);
        return true;
    }

    // Verifica se já foi respondida
    if (pending.status === 'answered') {
        console.log(`[Learning] Pergunta ${parsed.id} já foi respondida anteriormente`);
        const targetJid = responderJid || learningService.getAdminJid();
        await sendMessage(targetJid,
            `⚠️ Pergunta *${parsed.id}* já foi respondida anteriormente!`);
        return true;
    }

    console.log(`[Learning] Processando resposta para pergunta ${parsed.id}`);

    // Formata a resposta com Gemini
    const formattedAnswer = await responseHandler.formatAdminResponse(
        parsed.answer,
        pending.question
    );

    // Aprende a resposta
    learningService.learnResponse(pending.question, formattedAnswer);

    // Envia ao cliente original
    await sendMessage(pending.clientJid, formattedAnswer);
    console.log(`[Learning] Resposta enviada ao cliente: ${pending.clientJid}`);

    // Marca como respondida
    learningService.markAsAnswered(parsed.id);

    // Notifica o grupo ou quem respondeu
    const confirmMsg = `✅ Resposta enviada para *${pending.clientName}* e salva na memória!\n\n` +
        `📝 Pergunta: "${pending.question.substring(0, 50)}..."`;

    if (learningService.hasAdminGroup()) {
        await sendMessage(learningService.getAdminJid(), confirmMsg);
    } else {
        // Fallback: notifica todos os admins
        const allAdmins = learningService.getAllAdminJids();
        for (const adminJid of allAdmins) {
            if (adminJid === responderJid) {
                // Quem respondeu recebe confirmação
                await sendMessage(adminJid, confirmMsg);
            } else {
                // Outros admins recebem aviso de quem respondeu
                await sendMessage(adminJid,
                    `ℹ️ *Outra pessoa já respondeu!*\n\n` +
                    `📝 Pergunta: "${pending.question.substring(0, 50)}..."\n` +
                    `✅ Resposta enviada ao cliente.`);
            }
        }
    }

    return true;
}

/**
 * Conecta ao WhatsApp
 */
async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState(authFolder);
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        logger,
        printQRInTerminal: false,  // Desabilitado - usamos QR em imagem
        auth: state,
        browser: ['Silfer Bot', 'Chrome', '120.0.0'],
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 0,
        keepAliveIntervalMs: 30000,
        emitOwnEvents: false,
        fireInitQueries: true,
        generateHighQualityLinkPreview: false,
        syncFullHistory: false,
        markOnlineOnConnect: true
    });

    // Evento: Atualização de conexão
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('\n[Bot] Gerando novo QR Code visual...');
            qrcode.toFile(qrFile, qr, {
                color: { dark: '#000000', light: '#FFFFFF' },
                width: 400
            }, (err) => {
                if (!err) {
                    console.log(`[Bot] QR Code salvo em ${qrFile}`);
                    openQrCode();
                }
            });
        }

        if (connection === 'open') {
            console.log('\n========================================');
            console.log('  Bot iniciado com Sistema de Aprendizado!');
            console.log(`  Admin: ${learningService.getAdminNumber()}`);
            console.log('========================================\n');

            cleanupQrCode();

            // Só busca grupos se ainda não tiver um salvo
            if (!learningService.hasAdminGroup()) {
                try {
                    const groups = await sock.groupFetchAllParticipating();
                    const groupList = Object.entries(groups);
                    console.log('[Bot] Buscando grupo TI...');
                    for (const [id, group] of groupList) {
                        console.log(`  - "${group.subject}" → ${id}`);
                        // Auto-detecta grupo TI
                        if (group.subject.toLowerCase().includes('ti') ||
                            group.subject.toLowerCase().includes('silfer')) {
                            learningService.setAdminGroup(id);
                            console.log(`[Bot] ✅ Grupo TI detectado e salvo: ${id}`);
                            break;
                        }
                    }
                } catch (e) {
                    console.log('[Bot] Erro ao listar grupos:', e.message);
                }
            } else {
                console.log(`[Bot] Grupo TI já configurado: ${learningService.getAdminGroupJid()}`);
            }
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const isLoggedOut = statusCode === DisconnectReason.loggedOut;

            console.log('[Bot] Conexão fechada:', lastDisconnect?.error?.message);

            if (isLoggedOut) {
                // Deslogado: limpa auth automaticamente e reconecta para novo QR
                console.log('[Bot] Conta deslogada. Limpando sessão para novo login...');
                try {
                    fs.rmSync(authFolder, { recursive: true, force: true });
                    console.log('[Bot] Pasta de autenticação removida.');
                } catch (e) {
                    console.error('[Bot] Erro ao limpar auth:', e.message);
                }
                // Aguarda um pouco e reconecta
                setTimeout(() => {
                    console.log('[Bot] Gerando novo QR Code...');
                    connectToWhatsApp();
                }, 2000);
            } else {
                // Desconexão temporária: apenas reconecta
                console.log('[Bot] Reconectando...');
                connectToWhatsApp();
            }
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // Evento: Mensagens recebidas
    sock.ev.on('messages.upsert', async (m) => {
        try {
            const msg = m.messages[0];
            if (!msg || m.type !== 'notify') return;
            if (msg.key.remoteJid === 'status@broadcast') return;

            // Se é mensagem enviada pelo próprio bot/celular (humano usando o celular)
            if (msg.key.fromMe) {
                const clientJid = msg.key.remoteJid;
                // Ignora broadcast e grupos
                if (!clientJid.includes('@g.us') && clientJid !== 'status@broadcast') {
                    // Marca que humano assumiu esta conversa por 5 min
                    setHumanTakeover(clientJid);
                }
                return;
            }

            // Ignora grupos comuns (só responde ao grupo admin)
            const isGroup = msg.key.remoteJid.includes('@g.us');
            const isAdminGroup = learningService.isFromAdminGroup(msg.key.remoteJid);
            if (isGroup && !isAdminGroup) {
                return; // Não responde a grupos comuns
            }

            const messageContent = msg.message;
            if (!messageContent) return;

            const userMessage =
                messageContent.conversation ||
                messageContent.extendedTextMessage?.text ||
                '';

            if (!userMessage) return;

            const from = msg.key.remoteJid;
            const pushName = msg.pushName || 'Cliente';
            // Em grupos, o remetente real vem em participant; em PV vem em remoteJid
            const senderJid = msg.key.participant || from;
            // Extrai número limpo (remove sufixos @s.whatsapp.net, @lid, etc)
            const phoneNumber = senderJid.replace(/@.*$/, '');

            // Extrai informações de mensagem citada (reply-to)
            const quotedMessage = messageContent.extendedTextMessage?.contextInfo?.quotedMessage;
            const quotedText = quotedMessage?.conversation || quotedMessage?.extendedTextMessage?.text || '';
            const quotedId = extractQuestionIdFromMessage(quotedText);

            console.log(`[Msg] ${pushName}: ${userMessage.substring(0, 50)}${userMessage.length > 50 ? '...' : ''}`);

            // ==========================================
            // VERIFICA RESPOSTA DO ADMIN/GRUPO (PRIORIDADE!)
            // ==========================================
            const isFromAdminGroup = learningService.isFromAdminGroup(from);
            const isAdminUser = learningService.isAdmin(phoneNumber);
            console.log(`[Debug] from: "${from}" | isGroup: ${from.includes('@g.us')} | isAdminGroup: ${isFromAdminGroup} | isAdmin: ${isAdminUser}`);

            // Verifica se é resposta via reply-to-message (marcação)
            if (quotedId && (isFromAdminGroup || isAdminUser)) {
                console.log(`[Debug] Resposta via marcação de mensagem para ID: ${quotedId}`);
                const syntheticMessage = `#${quotedId} ${userMessage}`;
                const wasAdminResponse = await processAdminResponse(syntheticMessage, from);
                if (wasAdminResponse) {
                    return;
                }
            }

            // Verifica se é resposta do grupo admin ou mensagem de admin com #
            if (userMessage.startsWith('#') && (isFromAdminGroup || isAdminUser)) {
                console.log(`[Debug] Tentando processar como resposta admin/grupo`);
                const wasAdminResponse = await processAdminResponse(userMessage, from);
                if (wasAdminResponse) {
                    return; // Era uma resposta do admin/grupo, já processamos
                }
            }

            // Verifica comandos de memória (! commands) para admins
            if (userMessage.startsWith('!') && (isFromAdminGroup || isAdminUser)) {
                const memoryResponse = learningService.processMemoryCommand(userMessage);
                if (memoryResponse) {
                    await sendMessage(from, memoryResponse);
                    console.log('[Bot] Comando de memória processado');
                    return;
                }
            }

            // Ignora mensagens de grupos (a menos que seja resposta admin acima)
            if (from.includes('@g.us')) {
                console.log('[Bot] Mensagem de grupo ignorada');
                return;
            }

            // Verifica se humano assumiu esta conversa (admin respondeu nos últimos 5 min)
            if (isHumanTakeover(from)) {
                console.log(`[Takeover] Bot silenciado - humano está atendendo ${from.split('@')[0]}`);
                return;
            }

            // Atualiza última interação do usuário (para limpeza de +30 dias)
            userService.updateLastInteraction(phoneNumber);

            // ==========================================
            // SISTEMA DE IDENTIFICAÇÃO DE USUÁRIOS
            // ==========================================

            // Verifica se usuário quer mudar o nome
            const nameChangeRequest = userService.detectNameChangeRequest(userMessage);
            if (nameChangeRequest && userService.isKnownUser(phoneNumber)) {
                if (nameChangeRequest === 'ASK_NEW_NAME') {
                    userService.setState(phoneNumber, 'awaiting_new_name');
                    await sendMessage(from, '😊 Claro! Como você quer que eu te chame?');
                    return;
                } else {
                    userService.updateName(phoneNumber, nameChangeRequest);
                    await sendMessage(from, userService.getNameChangedMessage(nameChangeRequest));
                    return;
                }
            }

            // Verifica estado de conversa (aguardando resposta de identificação)
            const state = userService.getState(phoneNumber);

            if (state) {
                // Aguardando confirmação do nome
                if (state.state === 'awaiting_name_confirmation') {
                    if (userService.isPositiveResponse(userMessage)) {
                        // Confirmou o nome
                        userService.saveUser(phoneNumber, state.data.whatsappName, state.data.whatsappName);
                        userService.clearState(phoneNumber);
                        // Envia mensagem de boas-vindas
                        await sendMessage(from, userService.getWelcomeMessage(state.data.whatsappName));
                        startFollowUpTimer(from);
                        return;
                    } else if (userService.isNegativeResponse(userMessage)) {
                        // Negou o nome, pergunta o correto
                        userService.setState(phoneNumber, 'awaiting_name_input', state.data);
                        await sendMessage(from, userService.getAskNameMessage());
                        return;
                    }
                    // Se não for sim/não claro, continua perguntando
                    await sendMessage(from, 'Não entendi... Responda *SIM* ou *NÃO* 😅');
                    return;
                }

                // Aguardando input do nome
                if (state.state === 'awaiting_name_input' || state.state === 'awaiting_new_name') {
                    const newName = userMessage.trim().split(/\s+/)[0]; // Pega primeiro nome
                    if (newName.length > 1 && newName.length < 30) {
                        userService.saveUser(phoneNumber, newName, state.data?.whatsappName || pushName);
                        userService.clearState(phoneNumber);
                        // Envia mensagem de boas-vindas
                        await sendMessage(from, userService.getWelcomeMessage(newName));
                        startFollowUpTimer(from);
                        return;
                    }
                    await sendMessage(from, 'Por favor, me diga seu nome 😊');
                    return;
                }
            }

            // Usuário não está no banco - inicia identificação
            if (!userService.isKnownUser(phoneNumber)) {
                userService.setState(phoneNumber, 'awaiting_name_confirmation', { whatsappName: pushName });
                await sendMessage(from, userService.getNameConfirmationMessage(pushName));
                return;
            }

            // Usuário conhecido - usa nome salvo
            const userName = userService.getUserName(phoneNumber);
            console.log(`[UserService] Usuário conhecido: ${userName}`);

            // ==========================================
            // DETECTA SAUDAÇÕES -> MOSTRA BOAS-VINDAS
            // ==========================================
            if (responseHandler.isGreeting(userMessage)) {
                console.log('[Bot] Saudação detectada - Enviando boas-vindas');
                await sendMessage(from, userService.getWelcomeMessage(userName));
                startFollowUpTimer(from);
                return;
            }

            // Processa a mensagem
            const result = await responseHandler.processMessage(userMessage, {
                jid: from,
                name: pushName,
                phone: phoneNumber
            });

            if (!result) return;

            // Cancela timer de follow-up pois o cliente respondeu
            cancelFollowUpTimer(from);

            // Resposta conhecida
            if (result.type === 'response') {
                await sendMessage(from, result.text);
                console.log(`[Resposta] Enviada com sucesso`);

                // Salva no histórico
                conversationService.addMessage(phoneNumber, 'user', userMessage);
                conversationService.addMessage(phoneNumber, 'bot', result.text.substring(0, 200));

                // ==========================================
                // NOTIFICA ADMINS SOBRE LEADS
                // ==========================================
                const allAdmins = learningService.getAllAdminJids();

                // Detecta seleção de turma
                if (result.text.includes('Turma Semanal') && result.text.includes('formulário')) {
                    console.log('[Lead] Turma Semanal selecionada - Notificando admins');
                    const notif = learningService.formatTurmaLeadNotification(userName, phoneNumber, 'semanal');
                    for (const adminJid of allAdmins) {
                        await sendMessage(adminJid, notif);
                    }
                } else if (result.text.includes('Turma aos Sábados') && result.text.includes('formulário')) {
                    console.log('[Lead] Turma Sábado selecionada - Notificando admins');
                    const notif = learningService.formatTurmaLeadNotification(userName, phoneNumber, 'sabado');
                    for (const adminJid of allAdmins) {
                        await sendMessage(adminJid, notif);
                    }
                }
                // Detecta pedido de atendente
                else if (result.text.includes('Atendimento Humanizado') || result.text.includes('atendentes estará disponível')) {
                    console.log('[Lead] Atendimento humano solicitado - Notificando admins');
                    const notif = learningService.formatAttendantLeadNotification(userName, phoneNumber);
                    for (const adminJid of allAdmins) {
                        await sendMessage(adminJid, notif);
                    }
                }

                // Follow-up: só ativa em telas que PRECISAM de resposta
                // (menu principal, escolha de turma)
                // NÃO ativa em: localização, investimento, confirmação de turma, atendimento
                const isMenu = result.text.includes('Como posso ajudar?') || result.text.includes('Como posso ajudá-lo');
                const isTurma = result.text.includes('Escolha a sua Turma') && result.text.includes('Digite 1 ou 2');

                if (isMenu) {
                    startFollowUpTimer(from, 'menu', userName);
                } else if (isTurma) {
                    startFollowUpTimer(from, 'turma', userName);
                } else {
                    // Mensagens finais cancelam o timer
                    cancelFollowUpTimer(from);
                }
            }

            // Pergunta desconhecida - analisa com Gemini antes de encaminhar
            else if (result.type === 'unknown') {
                // Obtém nome e histórico
                const clientName = userService.getUserName(phoneNumber) || pushName;
                const historyText = conversationService.getHistoryAsText(phoneNumber);

                console.log(`[SmartFilter] Analisando mensagem com Gemini...`);

                // Analisa a mensagem com Gemini
                const analysis = await responseHandler.analyzeUnknownMessage(
                    userMessage,
                    historyText,
                    clientName
                );

                console.log(`[SmartFilter] Ação: ${analysis.action}`);

                // Salva no histórico
                conversationService.addMessage(phoneNumber, 'user', userMessage);

                if (analysis.action === 'clarify') {
                    // Pede esclarecimento
                    await sendMessage(from, analysis.response);
                    conversationService.addMessage(phoneNumber, 'bot', analysis.response);
                    console.log(`[SmartFilter] Pediu esclarecimento`);
                }
                else if (analysis.action === 'reject') {
                    // Recusa educadamente
                    await sendMessage(from, analysis.response);
                    conversationService.addMessage(phoneNumber, 'bot', analysis.response);
                    console.log(`[SmartFilter] Recusou pergunta fora do escopo`);
                }
                else if (analysis.action === 'answer') {
                    // Gemini responde diretamente
                    await sendMessage(from, analysis.response);
                    conversationService.addMessage(phoneNumber, 'bot', analysis.response);
                    console.log(`[SmartFilter] Gemini respondeu diretamente`);
                }
                else {
                    // FORWARD - Primeiro tenta busca semântica com Gemini
                    const questionToForward = analysis.contextualizedQuestion || userMessage;

                    console.log(`[SmartFilter] Tentando busca semântica antes de encaminhar...`);
                    const semanticMatch = await responseHandler.findSemanticMatch(questionToForward);

                    if (semanticMatch && semanticMatch.success) {
                        // Encontrou pergunta similar com resposta válida!
                        console.log(`[SemanticMatch] Respondendo com resposta similar`);
                        await sendMessage(from, semanticMatch.answer + '\n\n_Digite *MENU* para ver as opções._');
                        conversationService.addMessage(phoneNumber, 'bot', semanticMatch.answer);
                        return;
                    }

                    if (semanticMatch && semanticMatch.notifyAdmin) {
                        // Encontrou pergunta similar mas resposta não serve - notifica Pablo
                        console.log(`[SemanticMatch] Resposta inadequada, notificando admin...`);
                        const pabloJid = '5521990338405@s.whatsapp.net';
                        const alertMsg = `⚠️ *ALERTA: Resposta Inadequada*\n\n` +
                            `*Pergunta do cliente:*\n"${questionToForward}"\n\n` +
                            `*Pergunta similar encontrada:*\n"${semanticMatch.matchedQuestion}"\n\n` +
                            `*Resposta atual:*\n"${semanticMatch.matchedAnswer}"\n\n` +
                            `*Problema:* ${semanticMatch.issue}\n\n` +
                            `_A resposta atual não serve para esta pergunta. Por favor, corrija!_`;
                        await sendMessage(pabloJid, alertMsg);
                    }

                    // Se não encontrou match ou match inválido, encaminha ao admin normalmente
                    const pending = learningService.addPendingQuestion(
                        from,
                        clientName,
                        questionToForward
                    );

                    await sendMessage(from, learningService.getPendingResponseMessage());
                    conversationService.addMessage(phoneNumber, 'bot', 'Vou verificar com a equipe...');
                    console.log(`[SmartFilter] Encaminhando ao admin`);

                    const adminMessage = learningService.getAdminForwardMessage(pending);

                    // Verifica se tem grupo configurado
                    if (learningService.hasAdminGroup()) {
                        await sendMessage(learningService.getAdminJid(), adminMessage);
                    } else {
                        // Fallback: envia para todos os admins
                        console.log('[SmartFilter] Grupo não encontrado - enviando para todos os admins');
                        const allAdmins = learningService.getAllAdminJids();

                        // Primeira mensagem: aviso sobre grupo
                        const warningMsg = `⚠️ *Atenção:* Grupo TI não encontrado!\n` +
                            `Usando fallback para admins individuais.\n\n` +
                            `_Adicione o bot no grupo novamente para voltar ao normal._`;

                        for (const adminJid of allAdmins) {
                            await sendMessage(adminJid, warningMsg);
                            await sendMessage(adminJid, adminMessage);
                        }
                    }
                }
            }

        } catch (error) {
            console.error('[Erro] Ao processar mensagem:', error.message);
        }
    });

    process.on('SIGINT', async () => {
        console.log('\n[Bot] Encerrando...');
        if (sock) sock.end();
        process.exit(0);
    });
}

console.log('[Bot] Inicializando com Sistema de Aprendizado...');
connectToWhatsApp();

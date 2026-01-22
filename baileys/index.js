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

let sock = null;

// Sistema de Follow-up (lembrete após inatividade)
const FOLLOW_UP_DELAY_MS = 5 * 60 * 1000; // 5 minutos
const followUpTimers = new Map(); // Rastreia timers por número

const FOLLOW_UP_MESSAGE = `👋 *Oi! Ainda está por aí?*

Notei que você não respondeu. Posso ajudar em algo?

Se precisar, é só escolher uma opção:

*1* - Cursos Online
*2* - Cursos Presenciais
*3* - Horário de Funcionamento
*4* - Localização
*5* - Professores
*6* - Falar com Atendente

_Ou digite sua dúvida!_`;

/**
 * Inicia timer de follow-up para um cliente
 */
function startFollowUpTimer(jid) {
    // Cancela timer anterior se existir
    cancelFollowUpTimer(jid);

    const timer = setTimeout(async () => {
        console.log(`[Follow-up] Enviando lembrete para: ${jid}`);
        await sendMessage(jid, FOLLOW_UP_MESSAGE);
        followUpTimers.delete(jid);
    }, FOLLOW_UP_DELAY_MS);

    followUpTimers.set(jid, timer);
    console.log(`[Follow-up] Timer iniciado para: ${jid} (5 min)`);
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
 * Abre o QR Code
 */
function openQrCode() {
    const platform = process.platform;
    let command = '';

    if (platform === 'win32') {
        command = `start ${qrFile}`;
    } else if (platform === 'darwin') {
        command = `open ${qrFile}`;
    } else {
        command = `xdg-open ${qrFile}`;
    }

    exec(command, (error) => {
        if (error) {
            console.error('[Bot] Erro ao abrir QR Code:', error.message);
        } else {
            console.log('[Bot] QR Code aberto na tela.');
        }
    });
}

/**
 * Envia mensagem para um JID
 */
async function sendMessage(jid, text) {
    if (sock) {
        await sock.sendMessage(jid, { text });
    }
}

/**
 * Processa resposta do admin
 */
async function processAdminResponse(message) {
    const parsed = learningService.parseAdminResponse(message);

    if (!parsed) {
        return false;
    }

    const pending = learningService.getPendingById(parsed.id);

    if (!pending) {
        console.log(`[Learning] Pergunta ${parsed.id} não encontrada`);
        await sendMessage(learningService.getAdminJid(),
            `⚠️ ID *${parsed.id}* não encontrado nas perguntas pendentes.`);
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

    // Confirma ao admin
    await sendMessage(learningService.getAdminJid(),
        `✅ Resposta enviada para *${pending.clientName}* e salva no banco de conhecimento!\n\n` +
        `📝 Pergunta: "${pending.question.substring(0, 50)}..."`);

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
        printQRInTerminal: true,
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

            if (fs.existsSync(qrFile)) {
                try { fs.unlinkSync(qrFile); } catch { }
            }
        }

        if (connection === 'close') {
            const shouldReconnect =
                lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;

            console.log('[Bot] Conexão fechada:', lastDisconnect?.error?.message);

            if (shouldReconnect) {
                console.log('[Bot] Reconectando...');
                connectToWhatsApp();
            } else {
                console.log('[Bot] Deslogado. Remova a pasta auth para novo login.');
            }
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // Evento: Mensagens recebidas
    sock.ev.on('messages.upsert', async (m) => {
        try {
            const msg = m.messages[0];
            if (!msg || m.type !== 'notify' || msg.key.fromMe) return;
            if (msg.key.remoteJid.includes('@g.us')) return;
            if (msg.key.remoteJid === 'status@broadcast') return;

            const messageContent = msg.message;
            if (!messageContent) return;

            const userMessage =
                messageContent.conversation ||
                messageContent.extendedTextMessage?.text ||
                '';

            if (!userMessage) return;

            const from = msg.key.remoteJid;
            const pushName = msg.pushName || 'Cliente';
            const phoneNumber = from.replace('@s.whatsapp.net', '');

            console.log(`\n[Mensagem] De: ${pushName} (${phoneNumber})`);
            console.log(`[Mensagem] Texto: ${userMessage}`);

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

            // Verifica se é mensagem do admin com resposta
            if (phoneNumber === learningService.getAdminNumber()) {
                const wasAdminResponse = await processAdminResponse(userMessage);
                if (wasAdminResponse) {
                    return; // Era uma resposta, já processamos
                }
                // Se não era formato de resposta, processa normalmente
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

                // Se enviou o MENU, inicia timer de follow-up
                if (result.text.includes('Como posso ajudá-lo hoje?') || result.text.includes('Como posso ajudar?')) {
                    startFollowUpTimer(from);
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
                    // FORWARD - Encaminha ao admin com contexto
                    const questionToForward = analysis.contextualizedQuestion || userMessage;

                    const pending = learningService.addPendingQuestion(
                        from,
                        clientName,
                        questionToForward
                    );

                    await sendMessage(from, learningService.getPendingResponseMessage());
                    conversationService.addMessage(phoneNumber, 'bot', 'Vou verificar com a equipe...');
                    console.log(`[SmartFilter] Encaminhando ao admin`);

                    const adminMessage = learningService.getAdminForwardMessage(pending);
                    await sendMessage(learningService.getAdminJid(), adminMessage);
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

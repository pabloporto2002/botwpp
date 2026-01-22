/**
 * Bot Explorer v8 - Exploração Linear Estável
 * 
 * - Sem filtro de timestamp (aceita todas as msgs)
 * - Deduplicação no buffer
 * - Buffer de 5s para capturar múltiplas mensagens
 */

require('dotenv').config({ path: '../.env' });
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    delay
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const geminiService = require('../shared/geminiService');

// ===============================================
// CONFIGURAÇÃO
// ===============================================
const TARGET_NUMBER = '5511917848066'; // Estratégia Concursos
const INITIAL_MESSAGE = 'Tenho interesse na promoção do Estratégia Concursos';
const SESSION_NAME = process.env.SESSION_NAME || 'silfer-bot';
const AUTH_FOLDER = `./auth_${SESSION_NAME}`;
const OUTPUT_FILE = '../flowchart_result.json';
const OUTPUT_MD = '../flowchart_result.md';
const BUFFER_WINDOW_MS = 5000;
const MAX_DEPTH = 10;

const logger = pino({ level: 'silent' });

let conversationLog = [];
let sock = null;
let responseBuffer = [];
let bufferTimer = null;
let responseResolver = null;

// ===============================================
// HELPERS
// ===============================================
function extractText(msg) {
    if (!msg.message) return '';
    let text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';

    if (msg.message.buttonsMessage) {
        text += '\n' + (msg.message.buttonsMessage.contentText || '');
        const buttons = msg.message.buttonsMessage.buttons || [];
        buttons.forEach(b => text += `\n[Botão] ${b.buttonText?.displayText || ''}`);
    }
    if (msg.message.templateMessage) {
        text += '\n' + (msg.message.templateMessage.hydratedTemplate?.hydratedContentText || '');
        const buttons = msg.message.templateMessage.hydratedTemplate?.hydratedButtons || [];
        buttons.forEach(b => {
            if (b.quickReplyButton) text += `\n[Botão] ${b.quickReplyButton.displayText}`;
        });
    }
    return text.trim();
}

function extractOptions(text) {
    const options = [];
    const buttonRegex = /\[Botão\]\s*(.+)/g;
    let m;
    while ((m = buttonRegex.exec(text)) !== null) {
        options.push(m[1].trim());
    }
    const numRegex = /(\d+)\s*[-.)]\s*([^\n]+)/g;
    while ((m = numRegex.exec(text)) !== null) {
        options.push(m[1]);
    }
    return options;
}

const DEAD_END_KEYWORDS = ['atendente', 'humano', 'aguarde', 'transferindo'];

function isDeadEnd(text) {
    return DEAD_END_KEYWORDS.some(kw => text.toLowerCase().includes(kw));
}

async function generateQuestion(botResponse, history) {
    if (isDeadEnd(botResponse)) return null;

    const prompt = `VOCÊ É UM ALUNO interessado em concursos militares.
O Bot de um cursinho respondeu:
"""
${botResponse}
"""

Gere UMA pergunta curta para continuar a conversa.
Se houver opções/botões, escolha UMA para testar.
NÃO peça atendente.

Responda APENAS a pergunta.`;

    try {
        const res = await geminiService.generateResponse(prompt);
        const question = res.split('\n')[0].trim();
        return question.length > 2 ? question : null;
    } catch { return null; }
}

// ===============================================
// COMUNICAÇÃO
// ===============================================
function waitForResponse() {
    return new Promise((resolve) => {
        responseBuffer = [];
        responseResolver = resolve;

        setTimeout(() => {
            if (responseResolver) {
                const text = responseBuffer.join('\n\n');
                console.log(`[BUFFER] Timeout com ${responseBuffer.length} msgs`);
                responseResolver(text || null);
                responseResolver = null;
            }
        }, 30000);
    });
}

async function sendMessage(text) {
    const jid = `${TARGET_NUMBER}@s.whatsapp.net`;

    console.log(`\n[SEND] "${text}"`);

    const responsePromise = waitForResponse();
    await sock.sendMessage(jid, { text });
    const response = await responsePromise;

    if (response) {
        console.log(`[RECV] ${response.substring(0, 80).replace(/\n/g, ' ')}...`);
    } else {
        console.log('[RECV] Nenhuma resposta');
    }

    return response;
}

// ===============================================
// EXPLORAÇÃO LINEAR
// ===============================================
async function exploreLinear() {
    console.log('\n========================================');
    console.log('  EXPLORER v8 - Linear Estável');
    console.log('========================================\n');

    let response = await sendMessage(INITIAL_MESSAGE);
    if (!response) {
        console.log('[END] Sem resposta inicial.');
        return;
    }

    conversationLog.push({ sent: INITIAL_MESSAGE, received: response });

    for (let depth = 0; depth < MAX_DEPTH; depth++) {
        const options = extractOptions(response);
        let nextInput = null;

        if (options.length > 0) {
            nextInput = options[0];
            console.log(`[CHOICE] "${nextInput}" (de ${options.length})`);
        } else {
            console.log('[AI] Gerando pergunta...');
            nextInput = await generateQuestion(response, conversationLog);
            if (nextInput) console.log(`[AI] "${nextInput}"`);
        }

        if (!nextInput) {
            console.log('[END] Sem opções ou perguntas.');
            break;
        }

        if (isDeadEnd(response)) {
            console.log('[END] Dead-end (atendimento humano).');
            break;
        }

        await delay(2000);
        response = await sendMessage(nextInput);

        if (!response) {
            console.log('[END] Sem resposta.');
            break;
        }

        conversationLog.push({ sent: nextInput, received: response });
    }

    saveResults();
}

function saveResults() {
    const data = {
        targetNumber: TARGET_NUMBER,
        date: new Date().toISOString(),
        conversation: conversationLog
    };

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(data, null, 2), 'utf-8');

    let md = `# Exploração Linear: +${TARGET_NUMBER}\n\n`;
    md += `**Data:** ${data.date}\n`;
    md += `**Passos:** ${conversationLog.length}\n\n`;

    conversationLog.forEach((turn, i) => {
        md += `## ${i + 1}. ${turn.sent}\n\n`;
        md += `\`\`\`\n${turn.received}\n\`\`\`\n\n---\n\n`;
    });

    fs.writeFileSync(OUTPUT_MD, md, 'utf-8');
    console.log(`[SAVE] Salvos ${conversationLog.length} passos.`);
}

// ===============================================
// MAIN
// ===============================================
async function main() {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        logger,
        printQRInTerminal: true,
        auth: state,
        browser: ['Silfer Explorer v8', 'Chrome', '120.0.0'],
        connectTimeoutMs: 60000
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        if (update.connection === 'open') {
            delay(2000).then(() => {
                exploreLinear().then(() => {
                    console.log('\n========================================');
                    console.log('  CONCLUÍDO!');
                    console.log('========================================');
                    sock.end();
                    process.exit(0);
                }).catch(err => {
                    console.error('[ERROR]', err);
                    process.exit(1);
                });
            });
        }
    });

    // Listener - aceita TODAS as mensagens, com deduplicação
    sock.ev.on('messages.upsert', (m) => {
        const msg = m.messages[0];
        if (!msg || m.type !== 'notify' || msg.key.fromMe) return;

        const text = extractText(msg);
        if (!text) return;

        console.log(`[DEBUG] Msg: "${text.substring(0, 40)}..."`);

        if (responseResolver) {
            // Deduplicação
            if (!responseBuffer.includes(text)) {
                responseBuffer.push(text);
            }

            if (bufferTimer) clearTimeout(bufferTimer);
            bufferTimer = setTimeout(() => {
                if (responseResolver) {
                    const fullText = responseBuffer.join('\n\n');
                    console.log(`[BUFFER] Finalizado: ${responseBuffer.length} msgs`);
                    responseResolver(fullText);
                    responseResolver = null;
                    responseBuffer = [];
                }
            }, BUFFER_WINDOW_MS);
        }
    });
}

main().catch(console.error);

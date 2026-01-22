/**
 * Bot WhatsApp - Silfer Concursos
 * Versão: Venom-bot
 * 
 * Bot reativo que responde mensagens usando lógica híbrida
 * (JSON local + Gemini API)
 */

require('dotenv').config({ path: '../.env' });
const venom = require('venom-bot');
const responseHandler = require('../shared/responseHandler');

const sessionName = process.env.SESSION_NAME || 'silfer-bot';

// Configuração e inicialização do Venom
venom
    .create({
        session: sessionName,
        multidevice: true,
        headless: true,
        useChrome: false,
        debug: false,
        logQR: true,
        browserArgs: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
        ],
        autoClose: 60000,
        createPathFileToken: true,
        puppeteerOptions: {
            headless: true,
            args: ['--no-sandbox']
        }
    })
    .then((client) => start(client))
    .catch((error) => {
        console.error('[Bot] Erro ao inicializar:', error);
    });

/**
 * Função principal após conexão estabelecida
 * @param {object} client - Cliente Venom
 */
function start(client) {
    console.log('\n========================================');
    console.log('  SILFER CONCURSOS - WhatsApp Bot');
    console.log('  Versão: Venom-bot');
    console.log('========================================\n');
    console.log('[Bot] Conectado e pronto para uso!\n');

    // Listener de mensagens
    client.onMessage(async (message) => {
        try {
            // Ignora mensagens de grupos
            if (message.isGroupMsg) {
                return;
            }

            // Ignora mensagens de status/broadcast
            if (message.from === 'status@broadcast') {
                return;
            }

            // Ignora mensagens do próprio bot
            if (message.fromMe) {
                return;
            }

            // Ignora mensagens que não são texto
            if (message.type !== 'chat') {
                return;
            }

            const userMessage = message.body;
            console.log(`\n[Mensagem] De: ${message.from}`);
            console.log(`[Mensagem] Texto: ${userMessage}`);

            // Processa a mensagem e obtém resposta
            const response = await responseHandler.processMessage(userMessage);

            if (response) {
                await client.sendText(message.from, response);
                console.log(`[Resposta] Enviada com sucesso`);
            }

        } catch (error) {
            console.error('[Erro] Ao processar mensagem:', error.message);
        }
    });

    // Listener de estado da conexão
    client.onStateChange((state) => {
        console.log('[Bot] Estado alterado:', state);

        if (state === 'CONFLICT' || state === 'UNLAUNCHED') {
            client.useHere();
        }
    });

    // Tratamento de encerramento gracioso
    process.on('SIGINT', async () => {
        console.log('\n[Bot] Encerrando...');
        await client.close();
        process.exit(0);
    });
}

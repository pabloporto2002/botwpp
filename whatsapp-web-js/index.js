/**
 * Bot WhatsApp - Silfer Concursos
 * Versão: whatsapp-web.js
 * 
 * Bot reativo que responde mensagens usando lógica híbrida
 * (JSON local + Gemini API)
 */

require('dotenv').config({ path: '../.env' });
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const responseHandler = require('../shared/responseHandler');

// Configuração do cliente
const client = new Client({
    authStrategy: new LocalAuth({
        clientId: process.env.SESSION_NAME || 'silfer-bot'
    }),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
        ]
    }
});

// Evento: QR Code gerado
client.on('qr', (qr) => {
    console.log('\n========================================');
    console.log('  SILFER CONCURSOS - WhatsApp Bot');
    console.log('  Versão: whatsapp-web.js');
    console.log('========================================\n');
    console.log('Escaneie o QR Code abaixo com seu WhatsApp:\n');
    qrcode.generate(qr, { small: true });
});

// Evento: Autenticado
client.on('authenticated', () => {
    console.log('\n[Bot] Autenticação realizada com sucesso!');
});

// Evento: Pronto para uso
client.on('ready', () => {
    console.log('\n========================================');
    console.log('  Bot iniciado e pronto para uso!');
    console.log('========================================\n');
});

// Evento: Desconectado
client.on('disconnected', (reason) => {
    console.log('[Bot] Desconectado:', reason);
    console.log('[Bot] Tentando reconectar...');
    client.initialize();
});

// Evento: Mensagem recebida
client.on('message', async (msg) => {
    try {
        // Ignora mensagens de grupos
        if (msg.from.includes('@g.us')) {
            return;
        }

        // Ignora mensagens de status/broadcast
        if (msg.from === 'status@broadcast') {
            return;
        }

        // Ignora mensagens do próprio bot
        if (msg.fromMe) {
            return;
        }

        // Ignora mensagens que não são texto
        if (msg.type !== 'chat') {
            return;
        }

        const userMessage = msg.body;
        console.log(`\n[Mensagem] De: ${msg.from}`);
        console.log(`[Mensagem] Texto: ${userMessage}`);

        // Processa a mensagem e obtém resposta
        const response = await responseHandler.processMessage(userMessage);

        if (response) {
            await msg.reply(response);
            console.log(`[Resposta] Enviada com sucesso`);
        }

    } catch (error) {
        console.error('[Erro] Ao processar mensagem:', error.message);
    }
});

// Evento: Erro de autenticação
client.on('auth_failure', (msg) => {
    console.error('[Bot] Falha na autenticação:', msg);
});

// Inicializa o cliente
console.log('[Bot] Inicializando...');
client.initialize();

// Tratamento de encerramento gracioso
process.on('SIGINT', async () => {
    console.log('\n[Bot] Encerrando...');
    await client.destroy();
    process.exit(0);
});

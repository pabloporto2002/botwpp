
require('dotenv').config({ path: '../.env' });
const { GoogleGenerativeAI } = require('@google/generative-ai');

async function listAndTest() {
    // Pegar primeira key
    const key = process.env.GEMINI_API_KEY_1;
    if (!key) {
        console.error('No API Key found');
        return;
    }

    console.log('--- LISTING AVAILABLE MODELS ---');
    // Obs: A lib google-generative-ai em Node não expõe listModels facilmente na versão atual wrapper
    // Mas podemos tentar inferir ou usar fetch direto na API se necessário.
    // Melhor testar nomes conhecidos explicitamente.

    const CANDIDATES = [
        'gemini-2.0-flash-exp', // Experimental
        'gemini-2.0-flash',
        'gemini-1.5-flash',
        'gemini-1.5-flash-latest',
        'gemini-1.5-pro',
        'gemini-1.5-pro-latest',
        'gemini-1.0-pro',
        'gemini-pro'
    ];

    const genAI = new GoogleGenerativeAI(key);

    console.log(`Using Key: ${key.substring(0, 5)}...`);

    for (const modelName of CANDIDATES) {
        try {
            process.stdout.write(`Testing ${modelName}... `);
            const model = genAI.getGenerativeModel({ model: modelName });
            const result = await model.generateContent('Hi');
            const response = await result.response;
            console.log(`✅ OK - ${response.text().trim()}`);
        } catch (error) {
            let msg = error.message;
            if (msg.includes('404')) msg = 'Not Found';
            if (msg.includes('429')) msg = 'Quota Exceeded';
            console.log(`❌ FAIL - ${msg.substring(0, 50)}`);
        }
    }
}

listAndTest();

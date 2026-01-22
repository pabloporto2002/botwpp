
require('dotenv').config({ path: '../.env' });
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Modelos para testar
const MODELS = [
    'gemini-2.0-flash',
    'gemini-1.5-flash',
    'gemini-1.5-pro',
    'gemini-pro'
];

async function testKey(key, keyIndex) {
    console.log(`\nTesting Key ${keyIndex}...`);
    const genAI = new GoogleGenerativeAI(key);

    for (const modelName of MODELS) {
        try {
            const model = genAI.getGenerativeModel({ model: modelName });
            const result = await model.generateContent('Say hello');
            const response = await result.response;
            console.log(`✅ [SUCCESS] Model: ${modelName} - Response: ${response.text().trim()}`);
            return modelName; // Retorna o primeiro que funcionar
        } catch (error) {
            let errorMsg = error.message;
            if (errorMsg.includes('404')) errorMsg = 'Model not found or not supported';
            if (errorMsg.includes('429')) errorMsg = 'Quota exceeded';
            if (errorMsg.includes('400')) errorMsg = 'Bad Request (Invalid API Key?)';

            console.log(`❌ [FAILED]  Model: ${modelName} - Error: ${errorMsg}`);
        }
    }
    return null;
}

async function main() {
    console.log('--- STARTING MODEL VERIFICATION ---');

    let keyIndex = 1;
    let workingKeyCount = 0;

    // Testa primeiras 3 chaves para não demorar muito
    while (process.env[`GEMINI_API_KEY_${keyIndex}`] && keyIndex <= 5) {
        const key = process.env[`GEMINI_API_KEY_${keyIndex}`];
        const success = await testKey(key, keyIndex);
        if (success) workingKeyCount++;
        keyIndex++;
    }

    console.log('\n--- SUMMARY ---');
    console.log(`Tested ${keyIndex - 1} keys.`);
    console.log(`Working keys found: ${workingKeyCount}`);
}

main();

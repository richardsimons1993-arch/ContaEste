const axios = require('axios');

async function testEndpoints() {
    const endpoints = [
        '/transactions',
        '/concepts',
        '/clients',
        '/debts',
        '/debtors',
        '/contracts',
        '/contracts/pending',
        '/contracts/invoiced-current',
        '/logs',
        '/suppliers',
        '/projects',
        '/users'
    ];

    console.log('--- Diagnóstico de API ---');
    for (const ep of endpoints) {
        try {
            const res = await axios.get(`http://localhost:3000/api${ep}`, { timeout: 3000 });
            console.log(`✅ ${ep}: ${Array.isArray(res.data) ? res.data.length : 'OK (Obj)'} items`);
        } catch (err) {
            console.error(`❌ ${ep} ERROR: ${err.message}${err.response ? ' - ' + JSON.stringify(err.response.data) : ''}`);
        }
    }
}

testEndpoints();

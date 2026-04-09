const axios = require('axios');

const API_URL = 'http://localhost:3000/api/transactions';

async function testSaveTransaction() {
    console.log('--- Testing Save Transaction ---');
    
    const testData = {
        id: 'TEST-' + Date.now(),
        type: 'income',
        amount: 1000,
        conceptId: '1',
        clientId: '', // Test empty string normalization
        supplierId: '',
        date: '2026-04-09',
        observation: 'Test transaction'
    };

    try {
        console.log('Sending transaction:', testData);
        const response = await axios.post(API_URL, testData);
        console.log('Success!', response.data);
    } catch (err) {
        console.error('Failed!', err.response ? err.response.data : err.message);
    }

    console.log('\n--- Testing Invalid Date ---');
    const invalidDateData = { ...testData, id: 'TEST-DATE-' + Date.now(), date: '2026-15-45' };
    try {
        console.log('Sending transaction with invalid date:', invalidDateData.date);
        const response = await axios.post(API_URL, invalidDateData);
        console.log('Success (Unexpected?):', response.data);
    } catch (err) {
        console.log('Expected Error caught:', err.response ? err.response.data : err.message);
    }
}

testSaveTransaction();

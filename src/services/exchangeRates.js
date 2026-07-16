const axios = require('axios');

let ratesCache = {
    uf: { value: null, timestamp: 0, apiFailed: false },
    dolar: { value: null, timestamp: 0, apiFailed: false }
};
const CACHE_DURATION_MS = 60 * 60 * 1000;

async function updateRates() {
    const now = Date.now();
    
    // Si ambos valores en cache son válidos y vigentes, no consultar la API
    const isUfCached = ratesCache.uf.value && (now - ratesCache.uf.timestamp < CACHE_DURATION_MS);
    const isDolarCached = ratesCache.dolar.value && (now - ratesCache.dolar.timestamp < CACHE_DURATION_MS);
    
    if (isUfCached && isDolarCached) {
        return;
    }

    try {
        console.log('[API] Consultando mindicador.cl/api para actualizar divisas...');
        const response = await axios.get('https://mindicador.cl/api', { timeout: 8000 });
        if (response.data) {
            if (response.data.uf && response.data.uf.valor) {
                ratesCache.uf = { value: response.data.uf.valor, timestamp: now, apiFailed: false };
                console.log(`[API] UF obtenida con éxito: ${response.data.uf.valor}`);
            }
            if (response.data.dolar && response.data.dolar.valor) {
                ratesCache.dolar = { value: response.data.dolar.valor, timestamp: now, apiFailed: false };
                console.log(`[API] Dolar obtenido con éxito: ${response.data.dolar.valor}`);
            }
        }
    } catch (error) {
        console.error('Error actualizando divisas desde mindicador.cl:', error.message);
        ratesCache.uf.apiFailed = true;
        ratesCache.dolar.apiFailed = true;
    }
}

async function fetchUF() {
    await updateRates();
    return ratesCache.uf.value || 37800; // Fallback razonable
}

async function fetchDolar() {
    await updateRates();
    return ratesCache.dolar.value || 950; // Fallback razonable
}

function getRatesCacheState() {
    return {
        ufApiFailed: ratesCache.uf.apiFailed,
        dolarApiFailed: ratesCache.dolar.apiFailed
    };
}

module.exports = {
    fetchUF,
    fetchDolar,
    getRatesCacheState
};

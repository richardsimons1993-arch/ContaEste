const axios = require('axios');

let ratesCache = {
    uf: { value: null, timestamp: 0, apiFailed: false },
    dolar: { value: null, timestamp: 0, apiFailed: false }
};
const CACHE_DURATION_MS = 60 * 60 * 1000;

async function fetchUF() {
    const now = Date.now();
    if (ratesCache.uf.value && (now - ratesCache.uf.timestamp < CACHE_DURATION_MS)) {
        return ratesCache.uf.value;
    }
    try {
        const response = await axios.get('https://mindicador.cl/api/uf', { timeout: 5000 });
        if (response.data && response.data.serie && response.data.serie.length > 0) {
            const val = response.data.serie[0].valor;
            ratesCache.uf = { value: val, timestamp: now, apiFailed: false };
            console.log(`[API] UF obtenida de mindicador.cl: ${val}`);
            return val;
        }
        throw new Error('Formato de respuesta inválido de UF');
    } catch (error) {
        console.error('Error fetching UF from mindicador.cl:', error.message);
        ratesCache.uf.apiFailed = true;
    }
    return ratesCache.uf.value || 37800; // Fallback
}

async function fetchDolar() {
    const now = Date.now();
    if (ratesCache.dolar.value && (now - ratesCache.dolar.timestamp < CACHE_DURATION_MS)) {
        return ratesCache.dolar.value;
    }
    try {
        const response = await axios.get('https://mindicador.cl/api/dolar', { timeout: 5000 });
        if (response.data && response.data.serie && response.data.serie.length > 0) {
            const val = response.data.serie[0].valor;
            ratesCache.dolar = { value: val, timestamp: now, apiFailed: false };
            console.log(`[API] Dolar obtenido de mindicador.cl: ${val}`);
            return val;
        }
        throw new Error('Formato de respuesta inválido de Dólar');
    } catch (error) {
        console.error('Error fetching Dolar from mindicador.cl:', error.message);
        ratesCache.dolar.apiFailed = true;
    }
    return ratesCache.dolar.value || 950; // Fallback
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

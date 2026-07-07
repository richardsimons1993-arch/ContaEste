const express = require('express');
const router = express.Router();
const { fetchUF, fetchDolar, getRatesCacheState } = require('../services/exchangeRates');

// GET /api/uf
router.get('/uf', async (req, res) => {
    const uf = await fetchUF();
    if (uf) res.json({ valor: uf });
    else res.status(500).json({ error: "No se pudo obtener el valor de la UF" });
});

// GET /api/exchange-rates
router.get('/exchange-rates', async (req, res) => {
    const uf = await fetchUF();
    const dolar = await fetchDolar();
    const state = getRatesCacheState();
    res.json({ 
        uf: uf || 37800, 
        dolar: dolar || 950,
        ufApiFailed: state.ufApiFailed,
        dolarApiFailed: state.dolarApiFailed
    });
});

module.exports = router;

const express = require('express');
const router = express.Router();
const { getDbPool, sql } = require('../config/db');

// GET /api/logs
router.get('/', async (req, res) => {
    try {
        const pool = await getDbPool();
        const result = await pool.request().query('SELECT TOP 100 * FROM Logs ORDER BY timestamp DESC');
        const logs = result.recordset.map(l => ({
            ...l,
            category: l.module, // Alias para compatibilidad con código antiguo
            extraData: l.extraData ? JSON.parse(l.extraData) : null
        }));
        res.json(logs);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/logs
router.post('/', async (req, res) => {
    try {
        const l = req.body;
        const pool = await getDbPool();
        await pool.request()
            .input('id', sql.VarChar(50), l.id)
            .input('action', sql.VarChar(50), l.action)
            .input('module', sql.VarChar(50), l.module)
            .input('userName', sql.VarChar(100), l.userName || 'Sistema')
            .input('details', sql.VarChar(sql.MAX), l.details || '')
            .input('timestamp', sql.DateTime, new Date(l.timestamp))
            .input('extraData', sql.VarChar(sql.MAX), l.extraData ? JSON.stringify(l.extraData) : null)
            .query(`INSERT INTO Logs (id, action, module, userName, details, timestamp, extraData) VALUES (@id, @action, @module, @userName, @details, @timestamp, @extraData)`);
        res.json(l);
    } catch (err) {
        console.error('Error in POST /api/logs:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;

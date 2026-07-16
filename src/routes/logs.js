const express = require('express');
const router = express.Router();
const { getDbPool, sql } = require('../config/db');

// GET /api/logs
router.get('/', async (req, res) => {
    try {
        const pool = await getDbPool();
        const request = pool.request();
        const isAdmin = req.user && req.user.role === 'administrador';

        let query = 'SELECT TOP 500 * FROM Logs WHERE 1=1';

        if (!isAdmin) {
            query += " AND action NOT LIKE '%Error%' AND module NOT IN ('System', 'Express', 'Email')";
        }

        const { level, module: filterModule, startDate, endDate } = req.query;

        if (level === 'error') {
            query += " AND (action LIKE '%Error%' OR details LIKE '%Error%')";
        } else if (level === 'info') {
            query += " AND (action NOT LIKE '%Error%' AND details NOT LIKE '%Error%')";
        }

        if (filterModule && filterModule !== 'all') {
            request.input('module', sql.VarChar(50), filterModule);
            query += " AND module = @module";
        }

        if (startDate && !isNaN(new Date(startDate).getTime())) {
            request.input('startDate', sql.DateTime, new Date(startDate + 'T00:00:00'));
            query += " AND timestamp >= @startDate";
        }

        if (endDate && !isNaN(new Date(endDate).getTime())) {
            request.input('endDate', sql.DateTime, new Date(endDate + 'T23:59:59'));
            query += " AND timestamp <= @endDate";
        }

        query += ' ORDER BY timestamp DESC';

        const result = await request.query(query);
        const logs = result.recordset.map(l => ({
            ...l,
            category: l.module, // Alias para compatibilidad con código antiguo
            extraData: l.extraData ? JSON.parse(l.extraData) : null
        }));
        res.json(logs);
    } catch (err) {
        console.error('Error in GET /api/logs:', err);
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

// DELETE /api/logs/purge
router.delete('/purge', async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'administrador') {
            return res.status(403).json({ error: 'Acceso Denegado: Solo administradores pueden realizar esta acción.' });
        }

        const pool = await getDbPool();
        const result = await pool.request().query('DELETE FROM Logs WHERE timestamp < DATEADD(day, -30, GETDATE())');

        // Log the purge action itself!
        await pool.request()
            .input('id', sql.VarChar(50), Date.now().toString() + Math.floor(Math.random() * 1000).toString())
            .input('action', sql.VarChar(50), 'Limpieza')
            .input('module', sql.VarChar(50), 'System')
            .input('userName', sql.VarChar(100), req.user.username || 'Admin')
            .input('details', sql.VarChar(sql.MAX), `Purgados logs de más de 30 días. Filas eliminadas: ${result.rowsAffected[0]}`)
            .input('timestamp', sql.DateTime, new Date())
            .query(`INSERT INTO Logs (id, action, module, userName, details, timestamp) VALUES (@id, @action, @module, @userName, @details, @timestamp)`);

        res.json({ success: true, message: `Se eliminaron ${result.rowsAffected[0]} registros de logs antiguos.` });
    } catch (err) {
        console.error('Error in DELETE /api/logs/purge:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;

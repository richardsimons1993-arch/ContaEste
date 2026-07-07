const { getDbPool, sql } = require('../config/db');

const auditLogMiddleware = async (req, res, next) => {
    res.on('finish', async () => {
        if (['POST', 'PUT', 'DELETE'].includes(req.method) && res.statusCode >= 200 && res.statusCode < 300) {
            if (req.originalUrl.includes('/logs') || req.originalUrl.includes('/auth')) return;

            try {
                const pool = await getDbPool();
                const userName = req.user ? req.user.email : 'System';
                const action = req.method;
                
                const urlParts = req.originalUrl.split('/').filter(Boolean);
                const moduleName = urlParts[1] || 'unknown';
                
                const details = `Path: ${req.originalUrl}`;
                const extraData = JSON.stringify({ body: req.body, query: req.query });

                await pool.request()
                    .input('id', sql.VarChar(50), Date.now().toString() + Math.floor(Math.random() * 1000).toString())
                    .input('action', sql.VarChar(50), action)
                    .input('module', sql.VarChar(50), moduleName)
                    .input('userName', sql.VarChar(100), userName)
                    .input('details', sql.VarChar(sql.MAX), details)
                    .input('timestamp', sql.DateTime, new Date())
                    .input('extraData', sql.VarChar(sql.MAX), extraData)
                    .query(`INSERT INTO Logs (id, action, module, userName, details, timestamp, extraData) VALUES (@id, @action, @module, @userName, @details, @timestamp, @extraData)`);
            } catch (err) {
                console.error('Error guardando AuditLog:', err.message);
            }
        }
    });
    next();
};

module.exports = auditLogMiddleware;

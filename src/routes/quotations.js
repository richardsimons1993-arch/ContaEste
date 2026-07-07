const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { getDbPool, sql } = require('../config/db');
const { fetchDolar, fetchUF } = require('../services/exchangeRates');

// Limpiar cotizaciones antiguas (> 90 días)
async function cleanOldQuotations() {
    try {
        const pool = await getDbPool();
        const result = await pool.request().query('DELETE FROM Quotations WHERE createdAt < DATEADD(day, -90, GETDATE())');
        if (result.rowsAffected[0] > 0) {
            console.log(`🧹 Limpieza: Se eliminaron ${result.rowsAffected[0]} cotizaciones antiguas de la BD.`);
            await pool.request()
                .input('id', sql.VarChar(50), Date.now().toString() + Math.floor(Math.random() * 1000).toString())
                .input('action', sql.VarChar(50), 'Limpieza')
                .input('module', sql.VarChar(50), 'quotations')
                .input('userName', sql.VarChar(100), 'Sistema')
                .input('details', sql.VarChar(sql.MAX), `${result.rowsAffected[0]} cotizaciones antiguas (>90 días) eliminadas permanentemente`)
                .input('timestamp', sql.DateTime, new Date())
                .query(`INSERT INTO Logs (id, action, module, userName, details, timestamp) VALUES (@id, @action, @module, @userName, @details, @timestamp)`);
        }
    } catch (err) {
        console.error('Error en limpieza de cotizaciones:', err);
    }
}

// GET /api/quotations
router.get('/', async (req, res) => {
    try {
        await cleanOldQuotations();
        const pool = await getDbPool();
        const result = await pool.request().query('SELECT * FROM Quotations ORDER BY createdAt DESC');
        console.log(`📦 Historial: Sirviendo ${result.recordset.length} cotizaciones.`);
        res.json(result.recordset);
    } catch (err) {
        console.error('Error al obtener cotizaciones:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/quotations/next-id/:prefixOrId/:year
router.get('/next-id/:prefixOrId/:year', async (req, res) => {
    try {
        const year = parseInt(req.params.year);
        let prefix = req.params.prefixOrId;
        
        if (prefix.length > 5) {
            const pool = await getDbPool();
            const clientRes = await pool.request()
                .input('id', sql.VarChar(50), prefix)
                .query('SELECT name, nombreFantasia FROM Clients WHERE id = @id');
            
            if (clientRes.recordset.length > 0) {
                const c = clientRes.recordset[0];
                const nameStr = c.nombreFantasia || c.name || 'XXX';
                prefix = nameStr.replace(/[^A-Za-z]/g, '').substring(0, 3).toUpperCase().padEnd(3, 'X');
            } else {
                prefix = prefix.substring(0, 3).toUpperCase();
            }
        }

        const pool = await getDbPool();
        const pattern = prefix + '-' + year + '-%';
        const result = await pool.request()
            .input('year', sql.Int, year)
            .input('pattern', sql.VarChar(50), pattern)
            .query("SELECT ISNULL(MAX(correlative), 0) + 1 AS nextId FROM Quotations WHERE year = @year AND id LIKE @pattern");
        
        res.json({ nextId: result.recordset[0].nextId });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/quotations/next-version/:id
router.get('/next-version/:id', async (req, res) => {
    try {
        const pool = await getDbPool();
        const result = await pool.request()
            .input('id', sql.VarChar(50), req.params.id)
            .query('SELECT ISNULL(MAX(version), 0) + 1 AS nextVersion FROM Quotations WHERE id = @id');
        res.json({ nextVersion: result.recordset[0].nextVersion });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/quotations (Insert/Update & Sync to projects)
router.post('/', async (req, res) => {
    try {
        const q = req.body;
        const pool = await getDbPool();
        await pool.request()
            .input('id', sql.VarChar(50), q.id)
            .input('correlative', sql.Int, q.correlative)
            .input('year', sql.Int, q.year)
            .input('version', sql.Int, q.version || 1)
            .input('clientId', sql.VarChar(50), q.clientId)
            .input('clientName', sql.VarChar(255), q.clientName)
            .input('projectName', sql.VarChar(255), q.projectName || '')
            .input('requirements', sql.VarChar(sql.MAX), q.requirements || '')
            .input('technicalConditions', sql.VarChar(sql.MAX), q.technicalConditions || '')
            .input('commercialConditions', sql.VarChar(sql.MAX), q.commercialConditions || '')
            .input('items1', sql.VarChar(sql.MAX), JSON.stringify(q.items1 || []))
            .input('itemsOptional', sql.VarChar(sql.MAX), JSON.stringify(q.itemsOptional || []))
            .input('subtotal', sql.Decimal(18,2), q.subtotal)
            .input('iva', sql.Decimal(18,2), q.iva)
            .input('total', sql.Decimal(18,2), q.total)
            .input('currency', sql.VarChar(10), q.currency || 'CLP')
            .query(`
                MERGE Quotations AS target
                USING (SELECT @id AS id, @version AS version) AS source
                ON (target.id = source.id AND target.version = source.version)
                WHEN MATCHED THEN
                    UPDATE SET 
                        correlative = @correlative, year = @year, clientId = @clientId,
                        clientName = @clientName, projectName = @projectName,
                        requirements = @requirements, technicalConditions = @technicalConditions,
                        commercialConditions = @commercialConditions, items1 = @items1,
                        itemsOptional = @itemsOptional, subtotal = @subtotal, iva = @iva, total = @total,
                        currency = @currency
                WHEN NOT MATCHED THEN
                    INSERT (id, correlative, year, version, clientId, clientName, projectName, requirements, technicalConditions, commercialConditions, items1, itemsOptional, subtotal, iva, total, currency, createdAt)
                    VALUES (@id, @correlative, @year, @version, @clientId, @clientName, @projectName, @requirements, @technicalConditions, @commercialConditions, @items1, @itemsOptional, @subtotal, @iva, @total, @currency, GETDATE());
            `);

        try {
            const projectId = 'PROJ-' + q.id;
            const versionSuffix = (q.version && q.version > 1) ? ' v' + q.version : '';
            const finalProjectName = (q.projectName || 'Proyecto sin nombre') + versionSuffix;
            const projectStatus = 'Cotizado';

            let estimatedAmountClp = q.total;
            let conversionNote = '';
            if (q.currency === 'USD') {
                const rateUSD = q.exchangeRate || await fetchDolar();
                if (rateUSD) {
                    estimatedAmountClp = q.total * rateUSD;
                    conversionNote = ` (${q.total} USD a tasa de $${rateUSD} CLP)`;
                }
            } else if (q.currency === 'UF') {
                const rateUF = q.exchangeRate || await fetchUF();
                if (rateUF) {
                    estimatedAmountClp = q.total * rateUF;
                    conversionNote = ` (${q.total} UF a tasa de $${rateUF} CLP)`;
                }
            }
            estimatedAmountClp = Math.round(estimatedAmountClp);

            const projectCheck = await pool.request()
                .input('id', sql.VarChar(50), projectId)
                .query('SELECT id, status FROM Projects WHERE id = @id');

            if (projectCheck.recordset.length === 0) {
                await pool.request()
                    .input('id', sql.VarChar(50), projectId)
                    .input('projectName', sql.VarChar(255), finalProjectName)
                    .input('clientId', sql.VarChar(50), q.clientId)
                    .input('status', sql.VarChar(50), projectStatus)
                    .input('observations', sql.VarChar(sql.MAX), 'Creado automáticamente desde Cotización N° ' + q.id + conversionNote)
                    .input('estimatedAmount', sql.Decimal(18, 2), estimatedAmountClp)
                    .query(`
                        INSERT INTO Projects (id, projectName, clientId, status, observations, estimatedAmount, visitDate) 
                        VALUES (@id, @projectName, @clientId, @status, @observations, @estimatedAmount, GETDATE())
                    `);

                await pool.request()
                    .input('projectId', sql.VarChar(50), projectId)
                    .input('newStatus', sql.VarChar(50), projectStatus)
                    .input('note', sql.VarChar(sql.MAX), 'Creado automáticamente desde Cotización N° ' + q.id + versionSuffix + conversionNote)
                    .query(`
                        INSERT INTO ProjectHistory (projectId, previousStatus, newStatus, note, changeDate) 
                        VALUES (@projectId, NULL, @newStatus, @note, GETDATE())
                    `);
            } else {
                const currentStatus = projectCheck.recordset[0].status;
                await pool.request()
                    .input('id', sql.VarChar(50), projectId)
                    .input('projectName', sql.VarChar(255), finalProjectName)
                    .input('estimatedAmount', sql.Decimal(18, 2), estimatedAmountClp)
                    .query(`
                        UPDATE Projects 
                        SET projectName = @projectName, estimatedAmount = @estimatedAmount 
                        WHERE id = @id
                    `);
            }
        } catch (projErr) {
            console.error('Error al sincronizar cotización con proyectos:', projErr);
        }

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/quotations/:id/:version
router.delete('/:id/:version', async (req, res) => {
    try {
        const pool = await getDbPool();
        await pool.request()
            .input('id', sql.VarChar(50), req.params.id)
            .input('version', sql.Int, req.params.version)
            .query('DELETE FROM Quotations WHERE id = @id AND version = @version');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/quotations/save-pdf
router.post('/save-pdf', async (req, res) => {
    try {
        const { clientName, year, quotationId, projectName, pdfBase64 } = req.body;
        const base64Data = pdfBase64.includes('base64,') ? pdfBase64.split('base64,')[1] : pdfBase64;
        const safeProjectName = projectName ? `_${projectName.replace(/[^a-zA-Z0-9 -]/g, '_')}` : '';
        const fileName = `Cotizacion_${quotationId}${safeProjectName}_${clientName.replace(/[^a-zA-Z0-9 -]/g, '')}.pdf`;

        const isWindows = process.platform === 'win32';

        if (isWindows) {
            const baseDriveDir = path.join('C:', 'Users', 'Richard', 'OneDrive - SIMONS SPA', 'Simons SPA', 'Clientes', 'Cotizaciones APP');
            const yearDir = path.join(baseDriveDir, year.toString());
            const clientDir = path.join(yearDir, clientName);
            
            if (!fs.existsSync(baseDriveDir)) fs.mkdirSync(baseDriveDir, { recursive: true });
            if (!fs.existsSync(yearDir)) fs.mkdirSync(yearDir, { recursive: true });
            if (!fs.existsSync(clientDir)) fs.mkdirSync(clientDir, { recursive: true });

            const filePath = path.join(clientDir, fileName);
            fs.writeFileSync(filePath, base64Data, 'base64');
            console.log(`✅ PDF cotización guardado localmente (Windows): ${filePath}`);
            res.json({ success: true, filePath });
        } else {
            const localTempDir = path.join(process.cwd(), 'temp_pdfs');
            if (!fs.existsSync(localTempDir)) {
                fs.mkdirSync(localTempDir, { recursive: true });
            }
            const localFilePath = path.join(localTempDir, fileName);
            fs.writeFileSync(localFilePath, base64Data, 'base64');
            console.log(`✅ PDF cotización guardado localmente temporal: ${localFilePath}`);

            const { execFile } = require('child_process');
            const remoteDestDir = `onedrive_backup:Simons SPA/Clientes/Cotizaciones APP/${year}/${clientName}`;
            
            const rcloneArgs = ['copy', localFilePath, remoteDestDir];
            const rcloneConfigPath = '/home/administrador/.config/rclone/rclone.conf';
            if (fs.existsSync(rcloneConfigPath)) {
                rcloneArgs.push('--config', rcloneConfigPath);
            }
            
            execFile('/usr/bin/rclone', rcloneArgs, (error, stdout, stderr) => {
                try {
                    if (fs.existsSync(localFilePath)) {
                        fs.unlinkSync(localFilePath);
                    }
                } catch (unlinkErr) {
                    console.error('Error al eliminar PDF temporal:', unlinkErr);
                }

                if (error) {
                    console.error('Error al subir PDF de cotización con rclone:', error);
                    return res.status(500).json({ error: `Error de subida de documento: ${error.message}` });
                }
                
                console.log(`✅ PDF cotización subido con éxito a OneDrive (${remoteDestDir}/${fileName})`);
                res.json({ success: true, filePath: `${remoteDestDir}/${fileName}` });
            });
        }
    } catch (err) {
        console.error('Error al guardar PDF:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = {
    router,
    cleanOldQuotations
};

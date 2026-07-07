const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { getDbPool, sql } = require('../config/db');
const { fetchDolar, fetchUF } = require('../services/exchangeRates');
const { deleteRemoteFile } = require('../services/fileStorage');

// GET /api/projects
router.get('/', async (req, res) => {
    try {
        const pool = await getDbPool();
        const projectsRes = await pool.request().query('SELECT * FROM Projects');
        const historyRes = await pool.request().query('SELECT * FROM ProjectHistory ORDER BY changeDate DESC');
        
        const projects = projectsRes.recordset;
        const history = historyRes.recordset;

        const historyMap = {};
        history.forEach(h => {
            if (!historyMap[h.projectId]) historyMap[h.projectId] = [];
            historyMap[h.projectId].push(h);
        });

        const projectsWithHistory = projects.map(p => ({
            ...p,
            history: historyMap[p.id] || []
        }));

        res.json(projectsWithHistory);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/projects/:id
router.delete('/:id', async (req, res) => {
    try {
        const pool = await getDbPool();
        const prevRes = await pool.request()
            .input('id', sql.VarChar(50), req.params.id)
            .query('SELECT status FROM Projects WHERE id = @id');
        const prevStatus = prevRes.recordset.length > 0 ? prevRes.recordset[0].status : null;

        await pool.request()
            .input('id', sql.VarChar(50), req.params.id)
            .query("UPDATE Projects SET status = 'Eliminado' WHERE id = @id");

        await pool.request()
            .input('projectId', sql.VarChar(50), req.params.id)
            .input('prevStatus', sql.NVarChar(50), prevStatus)
            .query("INSERT INTO ProjectHistory (projectId, previousStatus, newStatus, changeDate, note) VALUES (@projectId, @prevStatus, 'Eliminado', GETDATE(), 'Proyecto eliminado (Soft Delete)')");
        
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/projects
router.post('/', async (req, res) => {
    try {
        const p = req.body;
        const pool = await getDbPool();
        const check = await pool.request().input('id', sql.VarChar(50), p.id).query('SELECT id FROM Projects WHERE id = @id');

        if (check.recordset.length > 0) {
            await pool.request()
                .input('id', sql.VarChar(50), p.id)
                .input('clientId', sql.VarChar(50), p.clientId)
                .input('projectName', sql.VarChar(255), p.projectName || null)
                .input('status', sql.VarChar(50), p.status)
                .input('observations', sql.VarChar(sql.MAX), p.observations || '')
                .input('visitDate', sql.Date, p.visitDate || null)
                .input('executionDate', sql.Date, p.executionDate || null)
                .input('estimatedAmount', sql.Decimal(18, 2), p.estimatedAmount || null)
                .input('finalAmount', sql.Decimal(18, 2), p.finalAmount || null)
                .query(`UPDATE Projects SET projectName=@projectName, clientId=@clientId, status=@status, observations=@observations, visitDate=@visitDate, executionDate=@executionDate, estimatedAmount=@estimatedAmount, finalAmount=@finalAmount WHERE id=@id`);
        } else {
            await pool.request()
                .input('id', sql.VarChar(50), p.id)
                .input('projectName', sql.VarChar(255), p.projectName || null)
                .input('clientId', sql.VarChar(50), p.clientId)
                .input('status', sql.VarChar(50), p.status || 'Evaluación')
                .input('observations', sql.VarChar(sql.MAX), p.observations || '')
                .input('visitDate', sql.Date, p.visitDate || null)
                .input('executionDate', sql.Date, p.executionDate || null)
                .input('estimatedAmount', sql.Decimal(18, 2), p.estimatedAmount || null)
                .input('finalAmount', sql.Decimal(18, 2), p.finalAmount || null)
                .query(`INSERT INTO Projects (id, projectName, clientId, status, observations, visitDate, executionDate, estimatedAmount, finalAmount) VALUES (@id, @projectName, @clientId, @status, @observations, @visitDate, @executionDate, @estimatedAmount, @finalAmount)`);
        }
        res.json(p);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/projects/:id/history
router.get('/:id/history', async (req, res) => {
    try {
        const pool = await getDbPool();
        const result = await pool.request()
            .input('projectId', sql.VarChar(50), req.params.id)
            .query('SELECT * FROM ProjectHistory WHERE projectId = @projectId ORDER BY changeDate DESC');
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/projects/:id/history
router.post('/:id/history', async (req, res) => {
    try {
        const h = req.body;
        const pool = await getDbPool();
        const req2 = pool.request()
            .input('projectId', sql.VarChar(50), req.params.id)
            .input('previousStatus', sql.VarChar(50), h.previousStatus || null)
            .input('newStatus', sql.VarChar(50), h.newStatus)
            .input('note', sql.VarChar(sql.MAX), h.note || '');

        if (h.changeDate) {
            req2.input('changeDate', sql.Date, h.changeDate);
            await req2.query(`INSERT INTO ProjectHistory (projectId, previousStatus, newStatus, note, changeDate) VALUES (@projectId, @previousStatus, @newStatus, @note, @changeDate)`);
        } else {
            await req2.query(`INSERT INTO ProjectHistory (projectId, previousStatus, newStatus, note) VALUES (@projectId, @previousStatus, @newStatus, @note)`);
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/projects/history/:id
router.delete('/history/:id', async (req, res) => {
    try {
        const pool = await getDbPool();
        await pool.request()
            .input('id', sql.Int, req.params.id)
            .query('DELETE FROM ProjectHistory WHERE id = @id');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/projects/history/:id
router.put('/history/:id', async (req, res) => {
    try {
        const h = req.body;
        const pool = await getDbPool();
        await pool.request()
            .input('id', sql.Int, req.params.id)
            .input('note', sql.VarChar(sql.MAX), h.note || '')
            .input('newStatus', sql.VarChar(50), h.newStatus)
            .input('changeDate', sql.Date, h.changeDate || null)
            .query('UPDATE ProjectHistory SET note = @note, newStatus = @newStatus, changeDate = @changeDate WHERE id = @id');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/projects/upload-po
router.post('/upload-po', async (req, res) => {
    try {
        const { clientName, year, projectId, pdfBase64, originalFileName } = req.body;

        if (!pdfBase64) {
            return res.status(400).json({ error: 'No se recibió archivo' });
        }

        const base64Data = pdfBase64.includes('base64,') ? pdfBase64.split('base64,')[1] : pdfBase64;
        const safeClientName = clientName ? clientName.replace(/[^a-zA-Z0-9 -]/g, '') : 'Varios';
        const ext = (originalFileName && originalFileName.includes('.')) ? originalFileName.split('.').pop() : 'pdf';
        const fileName = `OrdenCompra_${projectId}_${safeClientName}.${ext}`;

        const isWindows = process.platform === 'win32';

        const savePOPathToDB = async (poPath) => {
            try {
                const pool = await getDbPool();
                await pool.request()
                    .input('id', sql.VarChar(50), projectId)
                    .input('purchaseOrderPath', sql.VarChar(sql.MAX), poPath)
                    .query(`UPDATE Projects SET purchaseOrderPath=@purchaseOrderPath WHERE id=@id`);
                console.log(`✅ purchaseOrderPath guardado en BD para proyecto ${projectId}`);
            } catch (dbErr) {
                console.error('Error al guardar purchaseOrderPath en BD para proyecto:', dbErr.message);
            }
        };

        if (isWindows) {
            const baseDriveDir = path.join('C:', 'Users', 'Richard', 'OneDrive - SIMONS SPA', 'Simons SPA', 'Clientes', 'Ordenes de Compra APP');
            const yearDir = path.join(baseDriveDir, year.toString());
            const clientDir = path.join(yearDir, safeClientName);

            if (!fs.existsSync(baseDriveDir)) fs.mkdirSync(baseDriveDir, { recursive: true });
            if (!fs.existsSync(yearDir)) fs.mkdirSync(yearDir, { recursive: true });
            if (!fs.existsSync(clientDir)) fs.mkdirSync(clientDir, { recursive: true });

            const filePath = path.join(clientDir, fileName);
            fs.writeFileSync(filePath, base64Data, 'base64');

            await savePOPathToDB(filePath);
            console.log(`✅ Orden de Compra guardada localmente (Windows): ${filePath}`);
            res.json({ success: true, filePath });
        } else {
            const localTempDir = path.join(process.cwd(), 'temp_pdfs');
            if (!fs.existsSync(localTempDir)) {
                fs.mkdirSync(localTempDir, { recursive: true });
            }
            const localFilePath = path.join(localTempDir, fileName);
            fs.writeFileSync(localFilePath, base64Data, 'base64');
            console.log(`✅ Orden de Compra guardada localmente temporal: ${localFilePath}`);

            const { execFile } = require('child_process');
            const remoteDestDir = `onedrive_backup:Simons SPA/Clientes/Ordenes de Compra APP/${year}/${safeClientName}`;

            const rcloneArgs = ['copy', localFilePath, remoteDestDir];
            const rcloneConfigPath = '/home/administrador/.config/rclone/rclone.conf';
            if (fs.existsSync(rcloneConfigPath)) {
                rcloneArgs.push('--config', rcloneConfigPath);
            }

            execFile('/usr/bin/rclone', rcloneArgs, async (error, stdout, stderr) => {
                try {
                    if (fs.existsSync(localFilePath)) {
                        fs.unlinkSync(localFilePath);
                    }
                } catch (unlinkErr) {
                    console.error('Error al eliminar comprobante temporal:', unlinkErr);
                }

                if (error) {
                    console.error('Error al subir OC con rclone:', error);
                    return res.status(500).json({ error: `Error de subida de documento: ${error.message}` });
                }

                const finalPath = `${remoteDestDir}/${fileName}`;
                await savePOPathToDB(finalPath);
                console.log(`✅ Orden de Compra subida con éxito a OneDrive (${finalPath})`);
                res.json({ success: true, filePath: finalPath });
            });
        }
    } catch (err) {
        console.error('Error al guardar Orden de Compra de proyecto:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/projects/:id/download-po
router.get('/:id/download-po', async (req, res) => {
    try {
        const pool = await getDbPool();
        const result = await pool.request()
            .input('id', sql.VarChar(50), req.params.id)
            .query('SELECT purchaseOrderPath FROM Projects WHERE id = @id');
        
        if (result.recordset.length === 0 || !result.recordset[0].purchaseOrderPath) {
            return res.status(404).send('Orden de Compra no encontrada o no cargada.');
        }

        const poPath = result.recordset[0].purchaseOrderPath;
        const isWindows = process.platform === 'win32';
        const fileName = path.basename(poPath);

        if (isWindows) {
            if (fs.existsSync(poPath)) {
                res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
                res.sendFile(poPath);
            } else {
                res.status(404).send('Archivo local no encontrado en el servidor.');
            }
        } else {
            const { spawn } = require('child_process');
            const rcloneArgs = ['cat', poPath];
            const rcloneConfigPath = '/home/administrador/.config/rclone/rclone.conf';
            if (fs.existsSync(rcloneConfigPath)) {
                rcloneArgs.push('--config', rcloneConfigPath);
            }

            res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
            const ext = fileName.split('.').pop().toLowerCase();
            if (ext === 'pdf') res.setHeader('Content-Type', 'application/pdf');
            else if (ext === 'png') res.setHeader('Content-Type', 'image/png');
            else if (ext === 'jpg' || ext === 'jpeg') res.setHeader('Content-Type', 'image/jpeg');

            const child = spawn('/usr/bin/rclone', rcloneArgs);
            child.stdout.pipe(res);
            child.stderr.on('data', (data) => {
                console.error(`rclone cat stderr: ${data}`);
            });
            child.on('error', (err) => {
                console.error('rclone spawn error:', err);
                if (!res.headersSent) {
                    res.status(500).send(`Error de descarga: ${err.message}`);
                }
            });
        }
    } catch (err) {
        console.error('Error al descargar Orden de Compra:', err);
        res.status(500).send('Error interno del servidor.');
    }
});

// DELETE /api/projects/:id/po
router.delete('/:id/po', async (req, res) => {
    try {
        const pool = await getDbPool();
        const result = await pool.request()
            .input('id', sql.VarChar(50), req.params.id)
            .query('SELECT purchaseOrderPath FROM Projects WHERE id = @id');
        
        if (result.recordset.length === 0 || !result.recordset[0].purchaseOrderPath) {
            return res.status(404).json({ error: 'No hay OC asociada para eliminar.' });
        }

        const poPath = result.recordset[0].purchaseOrderPath;

        await pool.request()
            .input('id', sql.VarChar(50), req.params.id)
            .query('UPDATE Projects SET purchaseOrderPath = NULL WHERE id = @id');

        deleteRemoteFile(poPath);

        res.json({ success: true });
    } catch (err) {
        console.error('Error al eliminar OC de proyecto:', err);
        res.status(500).json({ error: err.message });
    }
});

// Exportación de la función de sincronización para usar en server startup
async function syncQuotationsToProjects() {
    console.log('--- Iniciando Sincronización de Cotizaciones a Proyectos ---');
    try {
        const pool = await getDbPool();
        const quotationsRes = await pool.request().query('SELECT * FROM Quotations');
        const quotations = quotationsRes.recordset;

        // Optimización N+1: Consultar todos los proyectos de una sola vez
        const projectsRes = await pool.request().query('SELECT id FROM Projects');
        const existingProjectIds = new Set(projectsRes.recordset.map(p => p.id));

        const hasUSD = quotations.some(q => q.currency === 'USD');
        const hasUF = quotations.some(q => q.currency === 'UF');

        const rateUSD = hasUSD ? await fetchDolar() : 950;
        const rateUF = hasUF ? await fetchUF() : 37800;

        for (const q of quotations) {
            const projectId = 'PROJ-' + q.id;
            const versionSuffix = (q.version && q.version > 1) ? ' v' + q.version : '';
            const finalProjectName = (q.projectName || 'Proyecto sin nombre') + versionSuffix;
            const projectStatus = 'Cotizado';

            // Búsqueda O(1) instantánea sin query SQL por cotización
            if (!existingProjectIds.has(projectId)) {
                let estimatedAmountClp = q.total;
                let conversionNote = '';
                if (q.currency === 'USD') {
                    estimatedAmountClp = q.total * rateUSD;
                    conversionNote = ` (${q.total} USD a tasa de $${rateUSD} CLP)`;
                } else if (q.currency === 'UF') {
                    estimatedAmountClp = q.total * rateUF;
                    conversionNote = ` (${q.total} UF a tasa de $${rateUF} CLP)`;
                }
                estimatedAmountClp = Math.round(estimatedAmountClp);

                console.log(`Creando proyecto faltante ${projectId} para Cotización N° ${q.id}`);
                await pool.request()
                    .input('id', sql.VarChar(50), projectId)
                    .input('projectName', sql.VarChar(255), finalProjectName)
                    .input('clientId', sql.VarChar(50), q.clientId)
                    .input('status', sql.VarChar(50), projectStatus)
                    .input('observations', sql.VarChar(sql.MAX), 'Creado automáticamente por sincronización de Cotización N° ' + q.id + conversionNote)
                    .input('estimatedAmount', sql.Decimal(18, 2), estimatedAmountClp)
                    .query(`
                        INSERT INTO Projects (id, projectName, clientId, status, observations, estimatedAmount, visitDate) 
                        VALUES (@id, @projectName, @clientId, @status, @observations, @estimatedAmount, GETDATE())
                    `);

                await pool.request()
                    .input('projectId', sql.VarChar(50), projectId)
                    .input('newStatus', sql.VarChar(50), projectStatus)
                    .input('note', sql.VarChar(sql.MAX), 'Creado automáticamente por sincronización de Cotización N° ' + q.id + versionSuffix + conversionNote)
                    .query(`
                        INSERT INTO ProjectHistory (projectId, previousStatus, newStatus, note, changeDate) 
                        VALUES (@projectId, NULL, @newStatus, @note, GETDATE())
                    `);

                await pool.request()
                    .input('id', sql.VarChar(50), Date.now().toString() + Math.floor(Math.random() * 1000).toString())
                    .input('action', sql.VarChar(50), 'Sincronización')
                    .input('module', sql.VarChar(50), 'projects')
                    .input('userName', sql.VarChar(100), 'Sistema')
                    .input('details', sql.VarChar(sql.MAX), `Proyecto ${projectId} creado automáticamente por sincronización de Cotización N° ${q.id}`)
                    .input('timestamp', sql.DateTime, new Date())
                    .query(`INSERT INTO Logs (id, action, module, userName, details, timestamp) VALUES (@id, @action, @module, @userName, @details, @timestamp)`);
                
                existingProjectIds.add(projectId);
            }
        }
        console.log('✅ Sincronización de Cotizaciones a Proyectos completada.');
    } catch (err) {
        console.error('❌ Error en sincronización de Cotizaciones a Proyectos:', err.message);
    }
}

module.exports = {
    router,
    syncQuotationsToProjects
};

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { getDbPool, sql, getApi } = require('../config/db');
const { deleteRemoteFile } = require('../services/fileStorage');

// GET
router.get('/', (req, res) => getApi(req, res, 'Transactions'));

// DELETE
router.delete('/:id', async (req, res) => {
    try {
        const pool = await getDbPool();
        
        // 1. Obtener invoicePath si existe para eliminarlo del almacenamiento remoto
        const result = await pool.request()
            .input('id', sql.VarChar(50), req.params.id)
            .query('SELECT invoicePath FROM Transactions WHERE id = @id');
        
        if (result.recordset.length > 0) {
            const invoicePath = result.recordset[0].invoicePath;
            if (invoicePath) {
                deleteRemoteFile(invoicePath); // Se ejecuta en segundo plano
            }
        }

        // 2. Eliminar de la base de datos
        await pool.request()
            .input('id', sql.VarChar(50), req.params.id)
            .query('DELETE FROM Transactions WHERE id = @id');

        res.json({ success: true });
    } catch (err) {
        console.error('Error al eliminar transacción:', err);
        res.status(500).json({ error: err.message });
    }
});

// Helper for parsing dates
function tryParseDate(dateStr) {
    if (!dateStr) return null;
    if (dateStr instanceof Date) return isNaN(dateStr.getTime()) ? null : dateStr;

    let d;
    if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
        d = new Date(dateStr);
    } else {
        const parts = dateStr.split('-');
        if (parts.length === 3 && parts[2].length === 4) {
            d = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
        } else {
            d = new Date(dateStr);
        }
    }
    return (d && !isNaN(d.getTime())) ? d : null;
}

// POST (Insert/Update)
router.post('/', async (req, res) => {
    try {
        const t = req.body;
        console.log('--- POST /api/transactions ---');
        console.log('Body:', t);

        const pool = await getDbPool();

        // Validar tipo según concepto (Seguridad extra)
        let finalType = t.type;
        if (t.conceptId) {
            const conceptCheck = await pool.request()
                .input('cid', sql.VarChar, t.conceptId)
                .query('SELECT type FROM Concepts WHERE id = @cid');
            if (conceptCheck.recordset.length > 0) {
                finalType = conceptCheck.recordset[0].type;
            }
        }
        
        const finalDate = tryParseDate(t.date);

        if (!finalDate) {
            console.error('Error: Fecha inválida recibida:', t.date);
            return res.status(400).json({ error: 'Fecha inválida. Use formato YYYY-MM-DD o DD-MM-YYYY.' });
        }

        const cleanClientId = (t.clientId && t.clientId.trim() !== '') ? t.clientId : null;
        const cleanSupplierId = (t.supplierId && t.supplierId.trim() !== '') ? t.supplierId : null;

        const check = await pool.request().input('id', sql.VarChar(50), t.id).query('SELECT id FROM Transactions WHERE id = @id');

        if (check.recordset.length > 0) {
            console.log('Actualizando transacción existente:', t.id);
            await pool.request()
                .input('id', sql.VarChar(50), t.id)
                .input('date', sql.Date, finalDate)
                .input('type', sql.VarChar(50), finalType)
                .input('conceptId', sql.VarChar(50), t.conceptId)
                .input('clientId', sql.VarChar(50), cleanClientId)
                .input('supplierId', sql.VarChar(50), cleanSupplierId)
                .input('amount', sql.Decimal(18, 2), t.amount)
                .input('observation', sql.VarChar(sql.MAX), t.observation || '')
                .input('invoicePath', sql.VarChar(sql.MAX), t.invoicePath || null)
                .query(`UPDATE Transactions SET date=@date, type=@type, conceptId=@conceptId, clientId=@clientId, supplierId=@supplierId, amount=@amount, observation=@observation, invoicePath=COALESCE(@invoicePath, invoicePath) WHERE id=@id`);
        } else {
            console.log('Insertando nueva transacción:', t.id);
            await pool.request()
                .input('id', sql.VarChar(50), t.id)
                .input('date', sql.Date, finalDate)
                .input('type', sql.VarChar(50), finalType)
                .input('conceptId', sql.VarChar(50), t.conceptId)
                .input('clientId', sql.VarChar(50), cleanClientId)
                .input('supplierId', sql.VarChar(50), cleanSupplierId)
                .input('amount', sql.Decimal(18, 2), t.amount)
                .input('observation', sql.VarChar(sql.MAX), t.observation || '')
                .input('invoicePath', sql.VarChar(sql.MAX), t.invoicePath || null)
                .query(`INSERT INTO Transactions (id, date, type, conceptId, clientId, supplierId, amount, observation, invoicePath) VALUES (@id, @date, @type, @conceptId, @clientId, @supplierId, @amount, @observation, @invoicePath)`);
        }
        console.log('✅ Operación exitosa');
        res.json({ ...t, type: finalType, clientId: cleanClientId, supplierId: cleanSupplierId, invoicePath: t.invoicePath || null });
    } catch (err) {
        console.error('❌ ERROR en POST /api/transactions:', err.message);
        res.status(500).json({ error: 'Error de servidor/BD: ' + err.message });
    }
});

// POST /upload-invoice
router.post('/upload-invoice', async (req, res) => {
    try {
        const { providerName, year, transactionId, description, pdfBase64, originalFileName } = req.body;

        if (!pdfBase64) {
            return res.status(400).json({ error: 'No se recibió archivo' });
        }

        const base64Data = pdfBase64.includes('base64,') ? pdfBase64.split('base64,')[1] : pdfBase64;
        const safeDescription = description ? `_${description.replace(/[^a-zA-Z0-9 -]/g, '_')}` : '';
        const safeProviderName = providerName ? providerName.replace(/[^a-zA-Z0-9 -]/g, '') : 'Varios';
        const ext = (originalFileName && originalFileName.includes('.')) ? originalFileName.split('.').pop() : 'pdf';
        const fileName = `Comprobante_${transactionId}${safeDescription}_${safeProviderName}.${ext}`;

        const isWindows = process.platform === 'win32';

        const saveInvoicePathToDB = async (invoicePath) => {
            try {
                const pool = await getDbPool();
                await pool.request()
                    .input('id', sql.VarChar(50), transactionId)
                    .input('invoicePath', sql.VarChar(sql.MAX), invoicePath)
                    .query(`UPDATE Transactions SET invoicePath=@invoicePath WHERE id=@id`);
                console.log(`✅ invoicePath guardado en BD para transacción ${transactionId}`);
            } catch (dbErr) {
                console.error('Error al guardar invoicePath en BD para transacción:', dbErr.message);
            }
        };

        if (isWindows) {
            const baseDriveDir = path.join('C:', 'Users', 'Richard', 'OneDrive - SIMONS SPA', 'Simons SPA', 'Clientes', 'Movimientos');
            const yearDir = path.join(baseDriveDir, year.toString());
            const providerDir = path.join(yearDir, safeProviderName);

            if (!fs.existsSync(baseDriveDir)) fs.mkdirSync(baseDriveDir, { recursive: true });
            if (!fs.existsSync(yearDir)) fs.mkdirSync(yearDir, { recursive: true });
            if (!fs.existsSync(providerDir)) fs.mkdirSync(providerDir, { recursive: true });

            const filePath = path.join(providerDir, fileName);
            fs.writeFileSync(filePath, base64Data, 'base64');

            await saveInvoicePathToDB(filePath);
            console.log(`✅ Comprobante guardado localmente (Windows): ${filePath}`);
            res.json({ success: true, filePath });
        } else {
            const localTempDir = path.join(process.cwd(), 'temp_pdfs');
            if (!fs.existsSync(localTempDir)) {
                fs.mkdirSync(localTempDir, { recursive: true });
            }
            const localFilePath = path.join(localTempDir, fileName);
            fs.writeFileSync(localFilePath, base64Data, 'base64');
            console.log(`✅ Comprobante guardado localmente temporal: ${localFilePath}`);

            const { execFile } = require('child_process');
            const remoteDestDir = `onedrive_backup:Simons SPA/Clientes/Movimientos/${year}/${safeProviderName}`;

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
                    console.error('Error al subir comprobante con rclone:', error);
                    return res.status(500).json({ error: `Error de subida de documento: ${error.message}` });
                }

                const finalPath = `${remoteDestDir}/${fileName}`;
                await saveInvoicePathToDB(finalPath);
                console.log(`✅ Comprobante subido con éxito a OneDrive (${finalPath})`);
                res.json({ success: true, filePath: finalPath });
            });
        }
    } catch (err) {
        console.error('Error al guardar factura:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /:id/download-invoice
router.get('/:id/download-invoice', async (req, res) => {
    try {
        const pool = await getDbPool();
        const result = await pool.request()
            .input('id', sql.VarChar(50), req.params.id)
            .query('SELECT invoicePath FROM Transactions WHERE id = @id');
        
        if (result.recordset.length === 0 || !result.recordset[0].invoicePath) {
            return res.status(404).send('Comprobante no encontrado o no cargado.');
        }

        const invoicePath = result.recordset[0].invoicePath;
        const isWindows = process.platform === 'win32';
        const fileName = path.basename(invoicePath);

        if (isWindows) {
            if (fs.existsSync(invoicePath)) {
                res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
                res.sendFile(invoicePath);
            } else {
                res.status(404).send('Archivo local no encontrado en el servidor.');
            }
        } else {
            const { spawn } = require('child_process');
            const rcloneArgs = ['cat', invoicePath];
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
        console.error('Error al descargar comprobante:', err);
        res.status(500).send('Error interno del servidor.');
    }
});

// DELETE /:id/invoice
router.delete('/:id/invoice', async (req, res) => {
    try {
        const pool = await getDbPool();
        const result = await pool.request()
            .input('id', sql.VarChar(50), req.params.id)
            .query('SELECT invoicePath FROM Transactions WHERE id = @id');
        
        if (result.recordset.length === 0 || !result.recordset[0].invoicePath) {
            return res.status(404).json({ error: 'No hay comprobante asociado para eliminar.' });
        }

        const invoicePath = result.recordset[0].invoicePath;

        // 1. Limpiar de la BD
        await pool.request()
            .input('id', sql.VarChar(50), req.params.id)
            .query('UPDATE Transactions SET invoicePath = NULL WHERE id = @id');

        // 2. Eliminar del almacenamiento remoto (segundo plano)
        deleteRemoteFile(invoicePath);

        res.json({ success: true });
    } catch (err) {
        console.error('Error al eliminar comprobante de transacción:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;

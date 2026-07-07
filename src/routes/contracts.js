const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { getDbPool, sql, getApi } = require('../config/db');
const { fetchUF, fetchDolar } = require('../services/exchangeRates');
const { deleteRemoteFile } = require('../services/fileStorage');

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(process.cwd(), 'uploads')),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const uploadDocument = multer({
    storage,
    limits: { fileSize: 15 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') cb(null, true);
        else cb(new Error('Solo se permiten archivos PDF'), false);
    }
});

// GET /api/contracts
router.get('/', (req, res) => getApi(req, res, 'Contracts'));

// DELETE /api/contracts/:id
router.delete('/:id', async (req, res) => {
    try {
        const pool = await getDbPool();
        const contractRes = await pool.request()
            .input('id', sql.VarChar(50), req.params.id)
            .query('SELECT documentPath FROM Contracts WHERE id = @id');
        
        const documentPath = contractRes.recordset[0]?.documentPath;
        
        await pool.request()
            .input('id', sql.VarChar, req.params.id)
            .query('DELETE FROM ContractHistory WHERE contractId = @id');

        await pool.request()
            .input('id', sql.VarChar, req.params.id)
            .query('DELETE FROM Contracts WHERE id = @id');

        if (documentPath) {
            deleteRemoteFile(documentPath).catch(err => console.error('Error borrando doc contrato:', err));
        }

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/contracts/:id/upload-document
router.post('/:id/upload-document', uploadDocument.single('document'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No se subió ningún archivo' });
        
        const pool = await getDbPool();
        const contractId = req.params.id;
        
        const contractRes = await pool.request()
            .input('id', sql.VarChar(50), contractId)
            .query(`
                SELECT c.clientId, c.startDate, cl.name as clientName 
                FROM Contracts c 
                JOIN Clients cl ON c.clientId = cl.id 
                WHERE c.id = @id
            `);
            
        if (contractRes.recordset.length === 0) {
            return res.status(404).json({ error: 'Contrato no encontrado' });
        }
        
        const contract = contractRes.recordset[0];
        const clientName = contract.clientName || 'SinCliente';
        const safeClientName = clientName.replace(/[^a-zA-Z0-9 -]/g, '');
        const startDate = contract.startDate;
        
        let year = new Date().getFullYear();
        if (startDate) {
            const dateObj = new Date(startDate);
            if (!isNaN(dateObj.getTime())) {
                year = dateObj.getFullYear();
            }
        }
        
        const fileName = req.file.originalname;
        const safeFileName = `${Date.now()}_${fileName}`;
        const uploadedFilePath = req.file.path;
        const localFilePath = path.join(path.dirname(uploadedFilePath), safeFileName);
        
        fs.renameSync(uploadedFilePath, localFilePath);
        
        const remoteDestDir = `onedrive_backup:Simons SPA/Clientes/Contratos APP/${year}/${safeClientName}`;
        const finalRemotePath = `${remoteDestDir}/${safeFileName}`;
        
        const rcloneArgs = ['copy', localFilePath, remoteDestDir];
        const rcloneConfigPath = '/home/administrador/.config/rclone/rclone.conf';
        if (fs.existsSync(rcloneConfigPath)) {
            rcloneArgs.push('--config', rcloneConfigPath);
        }
        
        const { execFile } = require('child_process');
        execFile('/usr/bin/rclone', rcloneArgs, async (error, stdout, stderr) => {
            try {
                if (fs.existsSync(localFilePath)) fs.unlinkSync(localFilePath);
            } catch (unlinkErr) {}

            if (error) {
                console.error('Error al subir documento de contrato:', error);
                return res.status(500).json({ error: 'Error de subida de documento.' });
            }
            
            await pool.request()
                .input('id', sql.VarChar(50), contractId)
                .input('path', sql.VarChar(sql.MAX), finalRemotePath)
                .query('UPDATE Contracts SET documentPath = @path WHERE id = @id');
                
            res.json({ success: true, documentPath: finalRemotePath });
        });
    } catch (err) {
        console.error('Error en upload contrato:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/contracts/:id/download-document
router.get('/:id/download-document', async (req, res) => {
    try {
        const pool = await getDbPool();
        const result = await pool.request()
            .input('id', sql.VarChar(50), req.params.id)
            .query('SELECT documentPath FROM Contracts WHERE id = @id');
            
        if (result.recordset.length === 0 || !result.recordset[0].documentPath) {
            return res.status(404).send('Documento no encontrado.');
        }
        
        const documentPath = result.recordset[0].documentPath;
        const fileName = path.basename(documentPath);
        
        const { spawn } = require('child_process');
        const rcloneArgs = ['cat', documentPath];
        const rcloneConfigPath = '/home/administrador/.config/rclone/rclone.conf';
        if (fs.existsSync(rcloneConfigPath)) {
            rcloneArgs.push('--config', rcloneConfigPath);
        }

        res.setHeader('Content-Disposition', `attachment; filename="${fileName.replace(/^\d+_/, '')}"`);
        const ext = fileName.split('.').pop().toLowerCase();
        if (ext === 'pdf') res.setHeader('Content-Type', 'application/pdf');
        
        const child = spawn('/usr/bin/rclone', rcloneArgs);
        child.stdout.pipe(res);
        child.on('error', (err) => {
            console.error('rclone spawn error:', err);
            if (!res.headersSent) res.status(500).send(`Error de descarga: ${err.message}`);
        });
    } catch (err) {
        res.status(500).send('Error interno del servidor.');
    }
});

// DELETE /api/contracts/:id/document
router.delete('/:id/document', async (req, res) => {
    try {
        const pool = await getDbPool();
        const result = await pool.request()
            .input('id', sql.VarChar(50), req.params.id)
            .query('SELECT documentPath FROM Contracts WHERE id = @id');
            
        if (result.recordset.length > 0 && result.recordset[0].documentPath) {
            const documentPath = result.recordset[0].documentPath;
            deleteRemoteFile(documentPath).catch(err => console.error('Error borrando:', err));
            
            await pool.request()
                .input('id', sql.VarChar(50), req.params.id)
                .query('UPDATE Contracts SET documentPath = NULL WHERE id = @id');
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/contracts (Insert/Update)
router.post('/', async (req, res) => {
    try {
        const c = req.body;
        const pool = await getDbPool();
        await pool.request()
            .input('id', sql.VarChar, c.id)
            .input('clientId', sql.VarChar, c.clientId)
            .input('amount', sql.Decimal(18, 2), c.amount)
            .input('startDate', sql.Date, c.startDate)
            .input('endDate', sql.Date, c.endDate)
            .input('billingDay', sql.Int, c.billingDay)
            .input('frequency', sql.VarChar, c.frequency || 'mensual')
            .input('currency', sql.VarChar, c.currency || 'CLP')
            .query(`
                IF EXISTS (SELECT 1 FROM Contracts WHERE id = @id)
                UPDATE Contracts SET 
                    clientId = @clientId, amount = @amount, startDate = @startDate, 
                    endDate = @endDate, billingDay = @billingDay, frequency = @frequency,
                    currency = @currency
                WHERE id = @id
                ELSE
                INSERT INTO Contracts (id, clientId, amount, startDate, endDate, billingDay, frequency, currency)
                VALUES (@id, @clientId, @amount, @startDate, @endDate, @billingDay, @frequency, @currency)
            `);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/contracts/pending
router.get('/pending', async (req, res) => {
    try {
        const pool = await getDbPool();
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = String(now.getMonth() + 1).padStart(2, '0');
        const currentDay = now.getDate();
        const currentPeriod = `${currentYear}-${currentMonth}`;
        const currentDateStr = `${currentYear}-${currentMonth}-${String(currentDay).padStart(2, '0')}`;

        const query = `
            SELECT * FROM Contracts 
            WHERE startDate <= @currentDate 
              AND (endDate IS NULL OR endDate >= @currentDate)
              AND billingDay <= @currentDay
              AND (lastInvoicedPeriod IS NULL OR lastInvoicedPeriod != @currentPeriod)
        `;
        const result = await pool.request()
            .input('currentDate', sql.Date, currentDateStr)
            .input('currentDay', sql.Int, currentDay)
            .input('currentPeriod', sql.VarChar, currentPeriod)
            .query(query);

        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/contracts/:id/invoice
router.post('/:id/invoice', async (req, res) => {
    try {
        const pool = await getDbPool();
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = String(now.getMonth() + 1).padStart(2, '0');
        const currentPeriod = `${currentYear}-${currentMonth}`;

        const contractId = req.params.id;

        const contractRes = await pool.request()
            .input('id', sql.VarChar(50), contractId)
            .query(`SELECT c.*, cl.name as clientName, cl.nombreFantasia as clientFantasyName
                    FROM Contracts c
                    LEFT JOIN Clients cl ON c.clientId = cl.id
                    WHERE c.id = @id`);

        if (contractRes.recordset.length === 0) {
            return res.status(404).json({ error: "Contrato no encontrado" });
        }

        const contract = contractRes.recordset[0];
        const debtorName = contract.clientName || 'Cliente Desconocido';
        let amount = contract.amount;
        let ufValueUsed = null;

        if (contract.currency === 'UF') {
            ufValueUsed = await fetchUF();
            if (!ufValueUsed) {
                return res.status(500).json({ error: "No se pudo obtener el valor de la UF. Verifique conexión." });
            }
            amount = Math.round(amount * ufValueUsed);
        }

        const amountFinal = Math.round(amount * 1.19); // 19% IVA

        await pool.request()
            .input('id', sql.VarChar(50), contractId)
            .input('period', sql.VarChar(50), currentPeriod)
            .query(`UPDATE Contracts SET lastInvoicedPeriod = @period WHERE id = @id`);

        const dueDate = new Date();
        const newDebtorId = 'D' + Date.now().toString() + Math.floor(Math.random() * 1000);
        const descriptionStr = `Mensualidad Contrato ${currentPeriod} (INC. IVA)`;

        await pool.request()
            .input('id', sql.VarChar(50), newDebtorId)
            .input('debtor', sql.VarChar(255), debtorName)
            .input('amount', sql.Decimal(18, 2), amountFinal)
            .input('dueDate', sql.Date, dueDate)
            .input('description', sql.VarChar(sql.MAX), descriptionStr)
            .input('status', sql.VarChar(50), 'pending')
            .query(`INSERT INTO Debtors (id, debtor, amount, dueDate, description, status) VALUES (@id, @debtor, @amount, @dueDate, @description, @status)`);

        const historyId = 'CH' + Date.now().toString() + Math.floor(Math.random() * 1000);

        await pool.request()
            .input('id', sql.VarChar(50), historyId)
            .input('contractId', sql.VarChar(50), contractId)
            .input('clientId', sql.VarChar(50), contract.clientId || '')
            .input('periodName', sql.VarChar(100), currentPeriod)
            .input('issueDate', sql.Date, dueDate)
            .input('amount', sql.Decimal(18, 2), contract.amount)
            .input('amountCLP', sql.Decimal(18, 2), amount)
            .input('ufValue', sql.Decimal(18, 4), ufValueUsed)
            .input('debtorId', sql.VarChar(50), newDebtorId)
            .query(`INSERT INTO ContractHistory (id, contractId, clientId, periodName, issueDate, amount, amountCLP, ufValue, debtorId) VALUES (@id, @contractId, @clientId, @periodName, @issueDate, @amount, @amountCLP, @ufValue, @debtorId)`);

        res.json({ success: true, period: currentPeriod });
    } catch (err) {
        console.error('Error in POST /api/contracts/:id/invoice:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/contracts/invoiced-history
router.get('/invoiced-history', async (req, res) => {
    try {
        const pool = await getDbPool();
        const query = `
            SELECT ch.*, cl.nombreFantasia as clientFantasyName, cl.name as clientName
            FROM ContractHistory ch
            LEFT JOIN Clients cl ON ch.clientId = cl.id
            ORDER BY ch.issueDate DESC
        `;
        const result = await pool.request().query(query);
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/contracts/:id/undo
router.post('/:id/undo', async (req, res) => {
    try {
        const pool = await getDbPool();
        const contractId = req.params.id;

        const historyRes = await pool.request()
            .input('contractId', sql.VarChar, contractId)
            .query(`SELECT TOP 1 id, debtorId, periodName FROM ContractHistory WHERE contractId = @contractId ORDER BY issueDate DESC`);

        if (historyRes.recordset.length > 0) {
            const history = historyRes.recordset[0];

            await pool.request()
                .input('id', sql.VarChar, history.id)
                .query(`DELETE FROM ContractHistory WHERE id = @id`);

            if (history.debtorId) {
                await pool.request()
                    .input('debtorId', sql.VarChar, history.debtorId)
                    .query(`DELETE FROM Debtors WHERE id = @debtorId`);
            }
        }

        await pool.request()
            .input('id', sql.VarChar, contractId)
            .query(`UPDATE Contracts SET lastInvoicedPeriod = '' WHERE id = @id`);

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/contracts/history/:clientId
router.get('/history/:clientId', async (req, res) => {
    try {
        const pool = await getDbPool();
        const result = await pool.request()
            .input('clientId', sql.VarChar, req.params.clientId)
            .query(`
                SELECT ch.*, d.status as debtStatus 
                FROM ContractHistory ch
                LEFT JOIN Debtors d ON ch.debtorId = d.id
                WHERE ch.clientId = @clientId
                ORDER BY ch.issueDate DESC
            `);
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;

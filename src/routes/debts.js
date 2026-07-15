const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { getDbPool, sql, getApi, deleteApi } = require('../config/db');
const { deleteRemoteFile } = require('../services/fileStorage');
const { sendEmail } = require('../services/email');

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

async function checkCajaChicaAlert(pool, amount) {
    try {
        const res = await pool.request()
            .query("SELECT id, amount FROM Availables WHERE location = 'Efectivo' OR classification = 'Caja'");
        
        if (res.recordset.length > 0) {
            const row = res.recordset[0];
            const currentAmount = parseFloat(row.amount || 0);
            
            // Calculamos cuánto quedaría si restáramos el gasto, pero SIN actualizar la DB
            const remainingAmount = currentAmount - amount;
            
            console.log(`[Caja Chica Alert Check] Saldo actual: ${currentAmount}, Gasto registrado: ${amount}, Saldo proyectado: ${remainingAmount}`);

            const limit = 100000;
            if (remainingAmount <= limit) {
                const userRes = await pool.request()
                    .query("SELECT name, Email FROM Users WHERE ReceiveOpExpenseAlerts = 1 AND Email IS NOT NULL");
                
                const formattedAmount = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(remainingAmount);
                
                for (const user of userRes.recordset) {
                    const emailSubject = `⚠️ ALERTA: Disponible de Caja Chica Crítico (${formattedAmount})`;
                    const emailHtml = `
                        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px; background-color: #fafafa;">
                            <div style="text-align: center; border-bottom: 2px solid #ff4d4f; padding-bottom: 10px; margin-bottom: 20px;">
                                <h2 style="color: #ff4d4f; margin: 0;">Alerta de Caja Chica Bajo el Mínimo</h2>
                            </div>
                            <p>Hola <strong>${user.name}</strong>,</p>
                            <p>Te informamos que tras registrarse un egreso de fondos, el saldo de la <strong>Caja Chica (Efectivo)</strong> ha alcanzado un nivel crítico, quedando menor o igual al 20% del fondo establecido.</p>
                            <div style="background-color: #fff1f0; border: 1px solid #ffa39e; padding: 15px; border-radius: 6px; margin: 20px 0; text-align: center;">
                                <span style="font-size: 1.1rem; color: #cf1322;">Disponible Proyectado:</span>
                                <h1 style="margin: 10px 0 0 0; font-size: 2.2rem; color: #cf1322; font-weight: bold;">${formattedAmount}</h1>
                            </div>
                            <p style="font-size: 0.9rem; color: #555;">Por favor, gestiona el reembolso o reposición de fondos a la brevedad.</p>
                            <hr style="border: 0; border-top: 1px solid #e0e0e0; margin: 25px 0;">
                            <p style="font-size: 0.8rem; color: #888; text-align: center;">Este es un mensaje automático enviado por el sistema ContaEste.</p>
                        </div>
                    `;
                    sendEmail({ to: user.Email, subject: emailSubject, html: emailHtml });
                }
            }
        }
    } catch (err) {
        console.error("Error al evaluar alerta de Caja Chica:", err);
    }
}

async function notifyOpExpenseCajaChicaApproved(pool, expenseName, amount) {
    try {
        const userRes = await pool.request()
            .query("SELECT name, Email FROM Users WHERE ReceiveOpExpenseAlerts = 1 AND Email IS NOT NULL");
        
        const formattedAmount = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(amount);
        
        for (const user of userRes.recordset) {
            const emailSubject = `✅ Gasto de Caja Chica Aprobado: ${expenseName} (${formattedAmount})`;
            const emailHtml = `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px; background-color: #fafafa;">
                    <div style="text-align: center; border-bottom: 2px solid #52c41a; padding-bottom: 10px; margin-bottom: 20px;">
                        <h2 style="color: #52c41a; margin: 0;">Gasto de Caja Chica Aprobado</h2>
                    </div>
                    <p>Hola <strong>${user.name}</strong>,</p>
                    <p>Te informamos que se ha aprobado y procesado un gasto operativo de tipo <strong>Caja Chica</strong>:</p>
                    <div style="background-color: #f6ffed; border: 1px solid #b7eb8f; padding: 15px; border-radius: 6px; margin: 20px 0;">
                        <p style="margin: 0 0 10px 0;"><strong>Detalle:</strong> ${expenseName}</p>
                        <p style="margin: 0; color: #389e0d; font-size: 1.2rem; font-weight: bold;">Monto: ${formattedAmount}</p>
                    </div>
                    <hr style="border: 0; border-top: 1px solid #e0e0e0; margin: 25px 0;">
                    <p style="font-size: 0.8rem; color: #888; text-align: center;">Este es un mensaje automático enviado por el sistema ContaEste.</p>
                </div>
            `;
            sendEmail({ to: user.Email, subject: emailSubject, html: emailHtml });
        }
    } catch (err) {
        console.error("Error al notificar gasto de Caja Chica aprobado:", err);
    }
}


// ==========================================
// CONCEPTS ROUTES
// ==========================================
router.get('/concepts', (req, res) => getApi(req, res, 'Concepts'));
router.delete('/concepts/:id', (req, res) => deleteApi(req, res, 'Concepts'));
router.post('/concepts', async (req, res) => {
    try {
        const c = req.body;
        const pool = await getDbPool();
        const check = await pool.request().input('id', sql.VarChar(50), c.id).query('SELECT id FROM Concepts WHERE id = @id');
        if (check.recordset.length > 0) {
            await pool.request()
                .input('id', sql.VarChar(50), c.id)
                .input('name', sql.VarChar(255), c.name)
                .input('type', sql.VarChar(50), c.type)
                .query(`UPDATE Concepts SET name=@name, type=@type WHERE id=@id`);
        } else {
            await pool.request()
                .input('id', sql.VarChar(50), c.id)
                .input('name', sql.VarChar(255), c.name)
                .input('type', sql.VarChar(50), c.type)
                .query(`INSERT INTO Concepts (id, name, type) VALUES (@id, @name, @type)`);
        }
        res.json(c);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// SUPPLIERS ROUTES
// ==========================================
router.get('/suppliers', (req, res) => getApi(req, res, 'Suppliers'));
router.delete('/suppliers/:id', (req, res) => deleteApi(req, res, 'Suppliers'));
router.post('/suppliers', async (req, res) => {
    try {
        const s = req.body;
        const pool = await getDbPool();
        const check = await pool.request().input('id', sql.VarChar(50), s.id).query('SELECT id FROM Suppliers WHERE id = @id');
        if (check.recordset.length > 0) {
            await pool.request()
                .input('id', sql.VarChar(50), s.id)
                .input('name', sql.VarChar(255), s.name)
                .input('rut', sql.VarChar(50), s.rut || '')
                .input('encargado', sql.VarChar(255), s.encargado || '')
                .input('phone', sql.VarChar(50), s.phone || '')
                .input('email', sql.VarChar(255), s.email || '')
                .input('address', sql.VarChar(255), s.address || '')
                .query(`UPDATE Suppliers SET name=@name, rut=@rut, encargado=@encargado, phone=@phone, email=@email, address=@address WHERE id=@id`);
        } else {
            await pool.request()
                .input('id', sql.VarChar(50), s.id)
                .input('name', sql.VarChar(255), s.name)
                .input('rut', sql.VarChar(50), s.rut || '')
                .input('encargado', sql.VarChar(255), s.encargado || '')
                .input('phone', sql.VarChar(50), s.phone || '')
                .input('email', sql.VarChar(255), s.email || '')
                .input('address', sql.VarChar(255), s.address || '')
                .query(`INSERT INTO Suppliers (id, name, rut, encargado, phone, email, address) VALUES (@id, @name, @rut, @encargado, @phone, @email, @address)`);
        }
        res.json(s);
    } catch (err) {
        console.error('Error in POST /api/suppliers:', err);
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// DEBTS (EGRESOS) ROUTES
// ==========================================
router.get('/debts', (req, res) => getApi(req, res, 'Debts'));
router.delete('/debts/:id', (req, res) => deleteApi(req, res, 'Debts'));
router.post('/debts', async (req, res) => {
    try {
        const d = req.body;
        const creditor = d.creditor || d.titular;
        const dueDate = d.dueDate || d.date;
        const pool = await getDbPool();
        const check = await pool.request().input('id', sql.VarChar, d.id).query('SELECT id FROM Debts WHERE id = @id');
        if (check.recordset.length > 0) {
            await pool.request()
                .input('id', sql.VarChar(50), d.id)
                .input('creditor', sql.VarChar(255), creditor)
                .input('amount', sql.Decimal(18, 2), d.amount)
                .input('dueDate', sql.Date, dueDate)
                .input('description', sql.VarChar(sql.MAX), d.description || '')
                .input('status', sql.VarChar(50), d.status || 'pending')
                .input('conceptId', sql.VarChar(50), d.conceptId || null)
                .input('supplierId', sql.VarChar(50), d.supplierId || null)
                .query(`UPDATE Debts SET creditor=@creditor, amount=@amount, dueDate=@dueDate, description=@description, status=@status, conceptId=@conceptId, supplierId=@supplierId WHERE id=@id`);
        } else {
            await pool.request()
                .input('id', sql.VarChar(50), d.id)
                .input('creditor', sql.VarChar(255), creditor)
                .input('amount', sql.Decimal(18, 2), d.amount)
                .input('dueDate', sql.Date, dueDate)
                .input('description', sql.VarChar(sql.MAX), d.description || '')
                .input('status', sql.VarChar(50), d.status || 'pending')
                .input('conceptId', sql.VarChar(50), d.conceptId || null)
                .input('supplierId', sql.VarChar(50), d.supplierId || null)
                .query(`INSERT INTO Debts (id, creditor, amount, dueDate, description, status, conceptId, supplierId) VALUES (@id, @creditor, @amount, @dueDate, @description, @status, @conceptId, @supplierId)`);
        }
        res.json(d);
    } catch (err) {
        console.error('Error in POST /api/debts:', err);
        res.status(500).json({ error: err.message });
    }
});

router.post('/debts/:id/pay', async (req, res) => {
    try {
        const pool = await getDbPool();
        const debtId = req.params.id;

        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // 1. Obtener la deuda
            const debtRes = await transaction.request()
                .input('id', sql.VarChar, debtId)
                .query(`SELECT creditor, amount, description, conceptId, supplierId FROM Debts WHERE id = @id`);

            if (debtRes.recordset.length === 0) {
                await transaction.rollback();
                return res.status(404).json({ error: 'Deuda no encontrada' });
            }

            const debt = debtRes.recordset[0];
            const moveId = 'T' + Date.now().toString() + Math.floor(Math.random() * 1000);
            const moveDate = new Date();
            const obsText = 'Pago a proveedor: ' + debt.creditor + (debt.description ? ' - ' + debt.description : '');

            const conceptIdToUse = debt.conceptId || '1';

            // 2. Crear movimiento (egreso)
            await transaction.request()
                .input('id', sql.VarChar, moveId)
                .input('date', sql.Date, moveDate)
                .input('type', sql.VarChar, 'expense')
                .input('conceptId', sql.VarChar, conceptIdToUse)
                .input('amount', sql.Decimal(18, 2), debt.amount)
                .input('observation', sql.VarChar(sql.MAX), obsText)
                .input('clientId', sql.VarChar, null)
                .input('supplierId', sql.VarChar, debt.supplierId || null)
                .query(`INSERT INTO Transactions (id, date, type, conceptId, amount, observation, clientId, supplierId) VALUES (@id, @date, @type, @conceptId, @amount, @observation, @clientId, @supplierId)`);

            // 3. Eliminar deuda
            await transaction.request()
                .input('id', sql.VarChar, debtId)
                .query(`DELETE FROM Debts WHERE id = @id`);

            await transaction.commit();
            res.json({ success: true, message: 'Deuda pagada y movimiento creado' });

        } catch (tErr) {
            try {
                if (transaction.isOpen) await transaction.rollback();
            } catch (rollbackErr) {
                console.error('Error en rollback de deuda pay:', rollbackErr.message);
            }
            throw tErr;
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// DEBTORS (INGRESOS) ROUTES
// ==========================================
router.get('/debtors', (req, res) => getApi(req, res, 'Debtors'));

router.delete('/debtors/:id', async (req, res) => {
    try {
        const pool = await getDbPool();
        
        const result = await pool.request()
            .input('id', sql.VarChar(50), req.params.id)
            .query('SELECT invoicePath FROM Debtors WHERE id = @id');
        
        if (result.recordset.length > 0) {
            const invoicePath = result.recordset[0].invoicePath;
            if (invoicePath) {
                deleteRemoteFile(invoicePath);
            }
        }

        await pool.request()
            .input('id', sql.VarChar(50), req.params.id)
            .query('DELETE FROM Debtors WHERE id = @id');

        res.json({ success: true });
    } catch (err) {
        console.error('Error al eliminar deudor:', err);
        res.status(500).json({ error: err.message });
    }
});

router.post('/debtors', async (req, res) => {
    try {
        const d = req.body;
        const debtorName = d.debtor || d.titular;
        const dueDate = d.dueDate || d.date;
        const pool = await getDbPool();
        const check = await pool.request().input('id', sql.VarChar(50), d.id).query('SELECT id FROM Debtors WHERE id = @id');
        if (check.recordset.length > 0) {
            await pool.request()
                .input('id', sql.VarChar(50), d.id)
                .input('debtor', sql.VarChar(255), debtorName)
                .input('amount', sql.Decimal(18, 2), d.amount)
                .input('dueDate', sql.Date, dueDate)
                .input('description', sql.VarChar(sql.MAX), d.description || '')
                .input('status', sql.VarChar(50), d.status || 'pending')
                .input('clientId', sql.VarChar(50), d.clientId || null)
                .input('invoicePath', sql.VarChar(sql.MAX), d.invoicePath || null)
                .query(`UPDATE Debtors SET debtor=@debtor, amount=@amount, dueDate=@dueDate, description=@description, status=@status, clientId=@clientId, invoicePath=@invoicePath WHERE id=@id`);
        } else {
            await pool.request()
                .input('id', sql.VarChar(50), d.id)
                .input('debtor', sql.VarChar(255), debtorName)
                .input('amount', sql.Decimal(18, 2), d.amount)
                .input('dueDate', sql.Date, dueDate)
                .input('description', sql.VarChar(sql.MAX), d.description || '')
                .input('status', sql.VarChar(50), d.status || 'pending')
                .input('clientId', sql.VarChar(50), d.clientId || null)
                .input('invoicePath', sql.VarChar(sql.MAX), d.invoicePath || null)
                .query(`INSERT INTO Debtors (id, debtor, amount, dueDate, description, status, clientId, invoicePath) VALUES (@id, @debtor, @amount, @dueDate, @description, @status, @clientId, @invoicePath)`);
        }
        res.json(d);
    } catch (err) {
        console.error('Error in POST /api/debtors:', err);
        res.status(500).json({ error: err.message });
    }
});

router.post('/debtors/:id/pay', async (req, res) => {
    try {
        const pool = await getDbPool();
        const debtorId = req.params.id;

        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const debtorRes = await transaction.request()
                .input('id', sql.VarChar, debtorId)
                .query(`SELECT debtor, amount, description, clientId FROM Debtors WHERE id = @id`);

            if (debtorRes.recordset.length === 0) {
                await transaction.rollback();
                return res.status(404).json({ error: "Deudor no encontrado" });
            }

            const debtor = debtorRes.recordset[0];
            const clientIdToUse = debtor.clientId;

            const moveId = 'T' + Date.now().toString() + Math.floor(Math.random() * 1000);
            const moveDate = new Date();
            const obsText = 'Pago deuda auto. Titular: ' + debtor.debtor + ' - Detalle: ' + (debtor.description || '');

            await transaction.request()
                .input('id', sql.VarChar, moveId)
                .input('date', sql.Date, moveDate)
                .input('type', sql.VarChar, 'income')
                .input('conceptId', sql.VarChar, '1')
                .input('amount', sql.Decimal(18, 2), debtor.amount)
                .input('observation', sql.VarChar(sql.MAX), obsText)
                .input('clientId', sql.VarChar, clientIdToUse)
                .query(`INSERT INTO Transactions (id, date, type, conceptId, amount, observation, clientId) VALUES (@id, @date, @type, @conceptId, @amount, @observation, @clientId)`);

            await transaction.request()
                .input('id', sql.VarChar, debtorId)
                .query(`DELETE FROM Debtors WHERE id = @id`);

            await transaction.request()
                .input('debtorId', sql.VarChar, debtorId)
                .query(`UPDATE ContractHistory SET debtorId = NULL WHERE debtorId = @debtorId`);

            await transaction.commit();
            res.json({ success: true, message: 'Deuda liquidada y movimiento creado' });

        } catch (tErr) {
            try {
                if (transaction.isOpen) await transaction.rollback();
            } catch (rollbackErr) {
                console.error('Error en rollback de deudor pay:', rollbackErr.message);
            }
            throw tErr;
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /debtors/upload-invoice
router.post('/debtors/upload-invoice', async (req, res) => {
    try {
        const { clientName, year, debtorId, description, pdfBase64, originalFileName } = req.body;

        if (!pdfBase64) {
            return res.status(400).json({ error: 'No se recibió archivo' });
        }

        const base64Data = pdfBase64.includes('base64,') ? pdfBase64.split('base64,')[1] : pdfBase64;
        const safeDescription = description ? `_${description.replace(/[^a-zA-Z0-9 -]/g, '_')}` : '';
        const safeClientName = clientName.replace(/[^a-zA-Z0-9 -]/g, '');
        const ext = (originalFileName && originalFileName.includes('.')) ? originalFileName.split('.').pop() : 'pdf';
        const fileName = `Factura_${debtorId}${safeDescription}_${safeClientName}.${ext}`;

        const isWindows = process.platform === 'win32';

        const saveInvoicePathToDB = async (invoicePath) => {
            try {
                const pool = await getDbPool();
                await pool.request()
                    .input('id', sql.VarChar(50), debtorId)
                    .input('invoicePath', sql.VarChar(sql.MAX), invoicePath)
                    .query(`UPDATE Debtors SET invoicePath=@invoicePath WHERE id=@id`);
                console.log(`✅ invoicePath guardado en BD para deudor ${debtorId}`);
            } catch (dbErr) {
                console.error('Error al guardar invoicePath en BD:', dbErr.message);
            }
        };

        if (isWindows) {
            const baseDriveDir = path.join('C:', 'Users', 'Richard', 'OneDrive - SIMONS SPA', 'Simons SPA', 'Clientes', 'Facturas APP');
            const yearDir = path.join(baseDriveDir, year.toString());
            const clientDir = path.join(yearDir, clientName);

            if (!fs.existsSync(baseDriveDir)) fs.mkdirSync(baseDriveDir, { recursive: true });
            if (!fs.existsSync(yearDir)) fs.mkdirSync(yearDir, { recursive: true });
            if (!fs.existsSync(clientDir)) fs.mkdirSync(clientDir, { recursive: true });

            const filePath = path.join(clientDir, fileName);
            fs.writeFileSync(filePath, base64Data, 'base64');

            await saveInvoicePathToDB(filePath);
            console.log(`✅ Factura guardada localmente (Windows): ${filePath}`);
            res.json({ success: true, filePath });
        } else {
            const localTempDir = path.join(process.cwd(), 'temp_pdfs');
            if (!fs.existsSync(localTempDir)) {
                fs.mkdirSync(localTempDir, { recursive: true });
            }
            const localFilePath = path.join(localTempDir, fileName);
            fs.writeFileSync(localFilePath, base64Data, 'base64');
            console.log(`✅ Factura guardada localmente temporal: ${localFilePath}`);

            const { execFile } = require('child_process');
            const remoteDestDir = `onedrive_backup:Simons SPA/Clientes/Facturas APP/${year}/${clientName}`;

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
                    console.error('Error al eliminar factura temporal:', unlinkErr);
                }

                if (error) {
                    console.error('Error al subir factura con rclone:', error);
                    return res.status(500).json({ error: `Error de subida de documento: ${error.message}` });
                }

                const finalPath = `${remoteDestDir}/${fileName}`;
                await saveInvoicePathToDB(finalPath);
                console.log(`✅ Factura subida con éxito a OneDrive (${finalPath})`);
                res.json({ success: true, filePath: finalPath });
            });
        }
    } catch (err) {
        console.error('Error al guardar PDF de factura de deudor:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /debtors/:id/download-invoice
router.get('/debtors/:id/download-invoice', async (req, res) => {
    try {
        const pool = await getDbPool();
        const result = await pool.request()
            .input('id', sql.VarChar(50), req.params.id)
            .query('SELECT invoicePath FROM Debtors WHERE id = @id');
        
        if (result.recordset.length === 0 || !result.recordset[0].invoicePath) {
            return res.status(404).send('Factura no encontrada o no cargada.');
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
        console.error('Error al descargar comprobante de deudor:', err);
        res.status(500).send('Error interno del servidor.');
    }
});

// DELETE /debtors/:id/invoice
router.delete('/debtors/:id/invoice', async (req, res) => {
    try {
        const pool = await getDbPool();
        const result = await pool.request()
            .input('id', sql.VarChar(50), req.params.id)
            .query('SELECT invoicePath FROM Debtors WHERE id = @id');
        
        if (result.recordset.length === 0 || !result.recordset[0].invoicePath) {
            return res.status(404).json({ error: 'No hay factura asociada para eliminar.' });
        }

        const invoicePath = result.recordset[0].invoicePath;

        await pool.request()
            .input('id', sql.VarChar(50), req.params.id)
            .query('UPDATE Debtors SET invoicePath = NULL WHERE id = @id');

        deleteRemoteFile(invoicePath);

        res.json({ success: true });
    } catch (err) {
        console.error('Error al eliminar factura de deudor:', err);
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// OPERATIONAL EXPENSES ROUTES
// ==========================================
router.get('/operational-expenses', (req, res) => getApi(req, res, 'dbo.[OperationalExpenses]'));
router.delete('/operational-expenses/:id', (req, res) => deleteApi(req, res, 'dbo.[OperationalExpenses]'));

router.post('/operational-expenses', async (req, res) => {
    try {
        const e = req.body;
        const pool = await getDbPool();
        const check = await pool.request().input('id', sql.VarChar(50), e.id).query('SELECT id FROM dbo.[OperationalExpenses] WHERE id = @id');
        
        const lastPaymentDate = e.lastPaymentDate ? tryParseDate(e.lastPaymentDate) : null;
        const nextPaymentDate = e.nextPaymentDate ? tryParseDate(e.nextPaymentDate) : null;

        if (check.recordset.length > 0) {
            await pool.request()
                .input('id', sql.VarChar(50), e.id)
                .input('name', sql.VarChar(255), e.name)
                .input('amount', sql.Decimal(18, 2), e.amount)
                .input('frequency', sql.VarChar(50), e.frequency)
                .input('lastPaymentDate', sql.Date, lastPaymentDate)
                .input('nextPaymentDate', sql.Date, nextPaymentDate)
                .input('description', sql.VarChar(sql.MAX), e.description || '')
                .input('status', sql.VarChar(50), e.status || 'active')
                .query(`UPDATE dbo.[OperationalExpenses] SET name=@name, amount=@amount, frequency=@frequency, lastPaymentDate=@lastPaymentDate, nextPaymentDate=@nextPaymentDate, description=@description, status=@status WHERE id=@id`);
        } else {
            await pool.request()
                .input('id', sql.VarChar(50), e.id)
                .input('name', sql.VarChar(255), e.name)
                .input('amount', sql.Decimal(18, 2), e.amount)
                .input('frequency', sql.VarChar(50), e.frequency)
                .input('lastPaymentDate', sql.Date, lastPaymentDate)
                .input('nextPaymentDate', sql.Date, nextPaymentDate)
                .input('description', sql.VarChar(sql.MAX), e.description || '')
                .input('status', sql.VarChar(50), e.status || 'active')
                .query(`INSERT INTO dbo.[OperationalExpenses] (id, name, amount, frequency, lastPaymentDate, nextPaymentDate, description, status) VALUES (@id, @name, @amount, @frequency, @lastPaymentDate, @nextPaymentDate, @description, @status)`);
        }
        res.json(e);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/operational-expenses/:id/pay', async (req, res) => {
    try {
        const pool = await getDbPool();
        const expenseId = req.params.id;

        const expenseRes = await pool.request()
            .input('id', sql.VarChar, expenseId)
            .query(`SELECT * FROM dbo.[OperationalExpenses] WHERE id = @id`);

        if (expenseRes.recordset.length === 0) {
            return res.status(404).json({ error: 'Gasto no encontrado' });
        }

        const expense = expenseRes.recordset[0];
        if (!expense.nextPaymentDate) {
            return res.status(400).json({ error: 'El gasto no tiene una próxima fecha de pago definida' });
        }
        
        const lastNextDate = new Date(expense.nextPaymentDate);
        let newNextDate = new Date(lastNextDate);
        
        switch (expense.frequency) {
            case 'monthly': 
                const expectedMonth = (newNextDate.getMonth() + 1) % 12;
                newNextDate.setMonth(newNextDate.getMonth() + 1); 
                if (newNextDate.getMonth() !== expectedMonth) newNextDate.setDate(0); 
                break;
            case 'quarterly': 
                const expectedQuarter = (newNextDate.getMonth() + 3) % 12;
                newNextDate.setMonth(newNextDate.getMonth() + 3); 
                if (newNextDate.getMonth() !== expectedQuarter) newNextDate.setDate(0);
                break;
            case 'semiannually': 
                const expectedSemi = (newNextDate.getMonth() + 6) % 12;
                newNextDate.setMonth(newNextDate.getMonth() + 6); 
                if (newNextDate.getMonth() !== expectedSemi) newNextDate.setDate(0);
                break;
            case 'yearly': 
                newNextDate.setFullYear(newNextDate.getFullYear() + 1); 
                break;
            default: 
                const expectedDef = (newNextDate.getMonth() + 1) % 12;
                newNextDate.setMonth(newNextDate.getMonth() + 1);
                if (newNextDate.getMonth() !== expectedDef) newNextDate.setDate(0);
        }

        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            await transaction.request()
                .input('id', sql.VarChar, expenseId)
                .input('lastPaymentDate', sql.Date, new Date())
                .input('nextPaymentDate', sql.Date, newNextDate)
                .query(`UPDATE dbo.[OperationalExpenses] SET lastPaymentDate = @lastPaymentDate, nextPaymentDate = @nextPaymentDate WHERE id = @id`);

            const moveId = 'T' + Date.now().toString();
            const obsText = expense.name;
            const paidAmount = req.body.amount;
            
            await transaction.request()
                .input('id', sql.VarChar, moveId)
                .input('date', sql.Date, new Date())
                .input('type', sql.VarChar, 'expense')
                .input('conceptId', sql.VarChar, '1774961310024')
                .input('amount', sql.Decimal(18, 2), paidAmount)
                .input('observation', sql.VarChar(sql.MAX), obsText)
                .input('clientId', sql.VarChar, null)
                .input('supplierId', sql.VarChar, null)
                .query(`INSERT INTO Transactions (id, date, type, conceptId, amount, observation, clientId, supplierId) VALUES (@id, @date, @type, @conceptId, @amount, @observation, @clientId, @supplierId)`);

            await transaction.commit();

            // Lógica de alerta de Caja Chica
            const isCajaChica = (expense.name && expense.name.toLowerCase().includes('caja chica')) ||
                                (expense.description && expense.description.toLowerCase().includes('caja chica'));
            if (isCajaChica) {
                // Evaluar si el egreso proyecta un disponible menor al 20%
                await checkCajaChicaAlert(pool, paidAmount);
                // Notificar que se aprobó/pagó un gasto de Caja Chica
                await notifyOpExpenseCajaChicaApproved(pool, expense.name, paidAmount);
            }

            res.json({ success: true, nextPaymentDate: newNextDate });
        } catch (tErr) {
            try {
                if (transaction.isOpen) await transaction.rollback();
            } catch (rollbackErr) {
                console.error('Error en rollback de gasto pay:', rollbackErr.message);
            }
            throw tErr;
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// AVAILABLES (DISPONIBLE) ROUTES
// ==========================================
router.get('/availables', (req, res) => getApi(req, res, 'Availables'));
router.delete('/availables/:id', (req, res) => deleteApi(req, res, 'Availables'));

router.post('/availables', async (req, res) => {
    try {
        const a = req.body;
        const pool = await getDbPool();
        const check = await pool.request().input('id', sql.VarChar(50), a.id).query('SELECT id FROM Availables WHERE id = @id');
        
        const placementDate = a.placementDate ? tryParseDate(a.placementDate) : null;
        const dueDate = a.dueDate ? tryParseDate(a.dueDate) : null;

        if (check.recordset.length > 0) {
            await pool.request()
                .input('id', sql.VarChar(50), a.id)
                .input('location', sql.VarChar(255), a.location)
                .input('classification', sql.VarChar(50), a.classification)
                .input('instrument', sql.VarChar(100), a.instrument || null)
                .input('amount', sql.Decimal(18, 2), a.amount)
                .input('placementDate', sql.Date, placementDate)
                .input('dueDate', sql.Date, dueDate)
                .input('observation', sql.VarChar(sql.MAX), a.observation || '')
                .query(`UPDATE Availables SET location=@location, classification=@classification, instrument=@instrument, amount=@amount, placementDate=@placementDate, dueDate=@dueDate, observation=@observation WHERE id=@id`);
        } else {
            await pool.request()
                .input('id', sql.VarChar(50), a.id)
                .input('location', sql.VarChar(255), a.location)
                .input('classification', sql.VarChar(50), a.classification)
                .input('instrument', sql.VarChar(100), a.instrument || null)
                .input('amount', sql.Decimal(18, 2), a.amount)
                .input('placementDate', sql.Date, placementDate)
                .input('dueDate', sql.Date, dueDate)
                .input('observation', sql.VarChar(sql.MAX), a.observation || '')
                .query(`INSERT INTO Availables (id, location, classification, instrument, amount, placementDate, dueDate, observation) VALUES (@id, @location, @classification, @instrument, @amount, @placementDate, @dueDate, @observation)`);
        }

        // Alerta de Caja Chica Baja al actualizar disponible directamente
        if (a.location === 'Efectivo' || a.classification === 'Caja') {
            const currentAmount = parseFloat(a.amount || 0);
            const limit = 100000; // 20% de 500.000
            if (currentAmount <= limit) {
                try {
                    const userRes = await pool.request()
                        .query("SELECT name, Email FROM Users WHERE ReceiveOpExpenseAlerts = 1 AND Email IS NOT NULL");
                    
                    const formattedAmount = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(currentAmount);
                    
                    for (const user of userRes.recordset) {
                        const emailSubject = `⚠️ ALERTA: Disponible de Caja Chica Crítico (${formattedAmount})`;
                        const emailHtml = `
                            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px; background-color: #fafafa;">
                                <div style="text-align: center; border-bottom: 2px solid #ff4d4f; padding-bottom: 10px; margin-bottom: 20px;">
                                    <h2 style="color: #ff4d4f; margin: 0;">Alerta de Caja Chica Bajo el Mínimo</h2>
                                </div>
                                <p>Hola <strong>${user.name}</strong>,</p>
                                <p>Te informamos que el saldo de la <strong>Caja Chica (Efectivo)</strong> se encuentra en un nivel crítico, menor o igual al 20% del fondo establecido.</p>
                                <div style="background-color: #fff1f0; border: 1px solid #ffa39e; padding: 15px; border-radius: 6px; margin: 20px 0; text-align: center;">
                                    <span style="font-size: 1.1rem; color: #cf1322;">Disponible Actual:</span>
                                    <h1 style="margin: 10px 0 0 0; font-size: 2.2rem; color: #cf1322; font-weight: bold;">${formattedAmount}</h1>
                                </div>
                                <p style="font-size: 0.9rem; color: #555;">Por favor, gestiona el reembolso o reposición de fondos a la brevedad.</p>
                                <hr style="border: 0; border-top: 1px solid #e0e0e0; margin: 25px 0;">
                                <p style="font-size: 0.8rem; color: #888; text-align: center;">Este es un mensaje automático enviado por el sistema ContaEste.</p>
                            </div>
                        `;
                        sendEmail({ to: user.Email, subject: emailSubject, html: emailHtml });
                    }
                } catch (emailErr) {
                    console.error("Error al procesar alerta de email de disponible de caja chica:", emailErr);
                }
            }
        }

        res.json(a);
    } catch (err) {
        console.error('Error in POST /api/availables:', err);
        res.status(500).json({ error: err.message });
    }
});

router.checkCajaChicaAlert = checkCajaChicaAlert;
module.exports = router;

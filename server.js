const express = require('express');
const cors = require('cors');
const sql = require('mssql/msnodesqlv8');
const bcrypt = require('bcrypt');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const BCRYPT_ROUNDS = 10;

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Aumentado para soportar base64 grandes (PDF)
app.use(express.static(__dirname)); // Sirve HTML, JS y CSS automáticamente

// Configuración de Conexión a SQL Server usando driver nativo (para evitar problemas de TCP/IP)
const dbConfig = {
    connectionString: 'Driver={ODBC Driver 18 for SQL Server};Server=localhost\\SIMONS;Database=ContabilidadDB;UID=sa;PWD=S0p0rt3!!2025;Encrypt=yes;TrustServerCertificate=yes;'
};

// Helper para parsear fechas de forma robusta (DD-MM-YYYY o YYYY-MM-DD)
function tryParseDate(dateStr) {
    if (!dateStr) return null;
    if (dateStr instanceof Date) return isNaN(dateStr.getTime()) ? null : dateStr;

    let d;
    // Si ya viene como YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
        d = new Date(dateStr);
    } else {
        // Intentar DD-MM-YYYY
        const parts = dateStr.split('-');
        if (parts.length === 3 && parts[2].length === 4) {
            d = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
        } else {
            d = new Date(dateStr);
        }
    }

    return (d && !isNaN(d.getTime())) ? d : null;
}

let poolPromise = null;

function getDbPool() {
    if (!poolPromise) {
        poolPromise = new sql.ConnectionPool(dbConfig)
            .connect()
            .then(pool => {
                console.log('✅ Conectado a SQL Server Express');
                return pool;
            })
            .catch(err => {
                console.error('❌ Error conectando a SQL Server: ', err);
                poolPromise = null;
                throw err;
            });
    }
    return poolPromise;
}

// UF Cache
let cachedUF = {
    valor: null,
    timestamp: 0
};

// Fetch UF from mindicador.cl
async function fetchUF() {
    const now = Date.now();
    // Cache por 1 hora (3600000 ms)
    if (cachedUF.valor && (now - cachedUF.timestamp < 3600000)) {
        return cachedUF.valor;
    }

    try {
        console.log('Fetching UF from external API...');
        const response = await axios.get('https://mindicador.cl/api/uf', { timeout: 15000 });
        if (response.data && response.data.serie && response.data.serie.length > 0) {
            cachedUF.valor = response.data.serie[0].valor;
            cachedUF.timestamp = now;
            return cachedUF.valor;
        }
    } catch (error) {
        console.error('Error fetching UF:', error.message);
    }
    return cachedUF.valor; // Fallback al cache si falla la API
}

// Rutas Genéricas
const getApi = async (req, res, table) => {
    try {
        const pool = await getDbPool();
        let query = `SELECT * FROM ${table}`;

        // Aliases para compatibilidad con el frontend
        if (table === 'Clients') query = `SELECT *, name as razonSocial FROM Clients`;
        if (table === 'Debts') query = `SELECT *, creditor as titular, dueDate as date FROM Debts`;
        if (table === 'Debtors') query = `SELECT *, debtor as titular, dueDate as date FROM Debtors`;
        if (table === 'Availables') query = `SELECT * FROM Availables`;

        const result = await pool.request().query(query);
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

const deleteApi = async (req, res, table) => {
    try {
        const pool = await getDbPool();
        await pool.request()
            .input('id', sql.VarChar, req.params.id)
            .query(`DELETE FROM ${table} WHERE id = @id`);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// --- ENDPOINTS PARA TRANSACTIONS ---
app.get('/api/transactions', (req, res) => getApi(req, res, 'Transactions'));
app.delete('/api/transactions/:id', (req, res) => deleteApi(req, res, 'Transactions'));

app.post('/api/transactions', async (req, res) => {
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

        // Normalizar IDs vacíos a NULL para evitar errores de clave foránea o datos basura
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
                .query(`UPDATE Transactions SET date=@date, type=@type, conceptId=@conceptId, clientId=@clientId, supplierId=@supplierId, amount=@amount, observation=@observation WHERE id=@id`);
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
                .query(`INSERT INTO Transactions (id, date, type, conceptId, clientId, supplierId, amount, observation) VALUES (@id, @date, @type, @conceptId, @clientId, @supplierId, @amount, @observation)`);
        }
        console.log('✅ Operación exitosa');
        res.json({ ...t, type: finalType, clientId: cleanClientId, supplierId: cleanSupplierId });
    } catch (err) {
        console.error('❌ ERROR en POST /api/transactions:', err.message);
        if (err.number) console.error('SQL Error Number:', err.number);
        res.status(500).json({ error: 'Error de servidor/BD: ' + err.message });
    }
});

// --- ENDPOINTS PARA PROJECTS ---
app.get('/api/projects', async (req, res) => {
    try {
        const pool = await getDbPool();
        const projectsRes = await pool.request().query('SELECT * FROM Projects');
        const historyRes = await pool.request().query('SELECT * FROM ProjectHistory ORDER BY changeDate DESC');
        
        const projects = projectsRes.recordset;
        const history = historyRes.recordset;

        // Mapear historial por ID de proyecto
        const historyMap = {};
        history.forEach(h => {
            if (!historyMap[h.projectId]) historyMap[h.projectId] = [];
            historyMap[h.projectId].push(h);
        });

        // Combinar datos
        const projectsWithHistory = projects.map(p => ({
            ...p,
            history: historyMap[p.id] || []
        }));

        res.json(projectsWithHistory);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.delete('/api/projects/:id', (req, res) => deleteApi(req, res, 'Projects'));

// --- ENDPOINTS PARA INVENTORY (INVENTARIO) ---
app.get('/api/inventory', (req, res) => getApi(req, res, 'Inventory'));
app.delete('/api/inventory/:id', (req, res) => deleteApi(req, res, 'Inventory'));
app.post('/api/inventory', async (req, res) => {
    try {
        const i = req.body;
        const pool = await getDbPool();
        const check = await pool.request().input('id', sql.VarChar(50), i.id).query('SELECT id FROM Inventory WHERE id = @id');

        if (check.recordset.length > 0) {
            await pool.request()
                .input('id', sql.VarChar(50), i.id)
                .input('product', sql.VarChar(255), i.product)
                .input('quantity', sql.Decimal(18, 2), i.quantity)
                .input('unitPrice', sql.Decimal(18, 2), i.unitPrice)
                .input('location', sql.VarChar(100), i.location)
                .query(`UPDATE Inventory SET product=@product, quantity=@quantity, unitPrice=@unitPrice, location=@location WHERE id=@id`);
        } else {
            await pool.request()
                .input('id', sql.VarChar(50), i.id)
                .input('product', sql.VarChar(255), i.product)
                .input('quantity', sql.Decimal(18, 2), i.quantity)
                .input('unitPrice', sql.Decimal(18, 2), i.unitPrice)
                .input('location', sql.VarChar(100), i.location)
                .query(`INSERT INTO Inventory (id, product, quantity, unitPrice, location) VALUES (@id, @product, @quantity, @unitPrice, @location)`);
        }
        res.json(i);
    } catch (err) {
        console.error('Error in POST /api/inventory:', err);
        res.status(500).json({ error: err.message });
    }
});

// --- ENDPOINTS PARA UBICACIONES (Globales) ---
app.get('/api/app-locations', (req, res) => getApi(req, res, 'AppLocations'));
app.delete('/api/app-locations/:id', (req, res) => deleteApi(req, res, 'AppLocations'));
app.post('/api/app-locations', async (req, res) => {
    try {
        const l = req.body;
        console.log('--- [API] POST /api/app-locations RECEIVED DATA: ---');
        console.log(JSON.stringify(l, null, 2));
        
        const pool = await getDbPool();
        const check = await pool.request().input('id', sql.VarChar(50), l.id).query('SELECT id FROM AppLocations WHERE id = @id');
        
        const typeToSave = l.type || 'inventory';
        console.log(`--- [API] Saving location ${l.name} with type: ${typeToSave}`);

        if (check.recordset.length > 0) {
            await pool.request()
                .input('id', sql.VarChar(50), l.id)
                .input('name', sql.VarChar(255), l.name)
                .input('type', sql.VarChar(50), typeToSave)
                .query(`UPDATE AppLocations SET name=@name, type=@type WHERE id=@id`);
        } else {
            await pool.request()
                .input('id', sql.VarChar(50), l.id)
                .input('name', sql.VarChar(255), l.name)
                .input('type', sql.VarChar(50), typeToSave)
                .query(`INSERT INTO AppLocations (id, name, type) VALUES (@id, @name, @type)`);
        }
        res.json(l);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- ENDPOINTS PARA INVENTORY HISTORY ---
app.get('/api/inventory/history', (req, res) => getApi(req, res, 'InventoryHistory ORDER BY timestamp DESC'));
app.post('/api/inventory/history', async (req, res) => {
    try {
        const h = req.body;
        const pool = await getDbPool();
        await pool.request()
            .input('id', sql.VarChar(50), h.id || Date.now().toString())
            .input('productId', sql.VarChar(50), h.productId)
            .input('productName', sql.VarChar(255), h.productName)
            .input('type', sql.VarChar(50), h.type)
            .input('origin', sql.VarChar(255), h.origin || null)
            .input('destination', sql.VarChar(255), h.destination || null)
            .input('quantityChange', sql.Decimal(18, 2), h.quantityChange || 0)
            .input('userId', sql.VarChar(50), h.userId || null)
            .input('userName', sql.VarChar(100), h.userName || null)
            .query(`INSERT INTO InventoryHistory (id, productId, productName, type, origin, destination, quantityChange, userId, userName) 
                    VALUES (@id, @productId, @productName, @type, @origin, @destination, @quantityChange, @userId, @userName)`);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- ENDPOINTS PARA CONCEPTS ---
app.get('/api/concepts', (req, res) => getApi(req, res, 'Concepts'));
app.delete('/api/concepts/:id', (req, res) => deleteApi(req, res, 'Concepts'));
app.post('/api/concepts', async (req, res) => {
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

// --- ENDPOINTS PARA CLIENTS ---
app.get('/api/clients', async (req, res) => {
    try {
        const pool = await getDbPool();
        const result = await pool.request().query('SELECT * FROM Clients');
        const clients = result.recordset.map(c => ({
            id: c.id,
            razonSocial: c.name,
            nombreFantasia: c.nombreFantasia,
            rut: c.rut,
            encargado: c.encargado,
            telefono: c.phone,
            correo: c.email,
            direccion: c.address
        }));
        res.json(clients);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/clients/:id', (req, res) => deleteApi(req, res, 'Clients'));

app.post('/api/clients', async (req, res) => {
    try {
        const c = req.body;
        const pool = await getDbPool();
        const clientId = c.id;

        const check = await pool.request().input('id', sql.VarChar(50), clientId).query('SELECT id FROM Clients WHERE id = @id');

        const clientName = c.razonSocial || c.name || 'Sin Nombre';

        if (check.recordset.length > 0) {
            await pool.request()
                .input('id', sql.VarChar(50), clientId)
                .input('name', sql.VarChar(255), clientName)
                .input('nombreFantasia', sql.VarChar(255), c.nombreFantasia || null)
                .input('rut', sql.VarChar(50), c.rut || null)
                .input('encargado', sql.VarChar(255), c.encargado || null)
                .input('phone', sql.VarChar(50), c.telefono || null)
                .input('email', sql.VarChar(255), c.correo || null)
                .input('address', sql.VarChar(255), c.direccion || null)
                .query(`UPDATE Clients SET name=@name, nombreFantasia=@nombreFantasia, rut=@rut, encargado=@encargado, phone=@phone, email=@email, address=@address WHERE id=@id`);
        } else {
            await pool.request()
                .input('id', sql.VarChar(50), clientId)
                .input('name', sql.VarChar(255), clientName)
                .input('nombreFantasia', sql.VarChar(255), c.nombreFantasia || null)
                .input('rut', sql.VarChar(50), c.rut || null)
                .input('encargado', sql.VarChar(255), c.encargado || null)
                .input('phone', sql.VarChar(50), c.telefono || null)
                .input('email', sql.VarChar(255), c.correo || null)
                .input('address', sql.VarChar(255), c.direccion || null)
                .query(`INSERT INTO Clients (id, name, nombreFantasia, rut, encargado, phone, email, address) VALUES (@id, @name, @nombreFantasia, @rut, @encargado, @phone, @email, @address)`);
        }
        res.json({ success: true, id: clientId });
    } catch (err) {
        console.error('Error in POST /api/clients:', err);
        res.status(500).json({ error: err.message });
    }
});

// --- ENDPOINTS PARA DEBTS ---
app.get('/api/debts', (req, res) => getApi(req, res, 'Debts'));
app.delete('/api/debts/:id', (req, res) => deleteApi(req, res, 'Debts'));
app.post('/api/debts', async (req, res) => {
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

app.post('/api/debts/:id/pay', async (req, res) => {
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

            // Usar conceptId del registro o Ventas(1) como fallback
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
            await transaction.rollback();
            throw tErr;
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- ENDPOINTS PARA SUPPLIERS ---
app.get('/api/suppliers', (req, res) => getApi(req, res, 'Suppliers'));
app.delete('/api/suppliers/:id', (req, res) => deleteApi(req, res, 'Suppliers'));
app.post('/api/suppliers', async (req, res) => {
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

// --- ENDPOINTS PARA DEBTORS ---
app.get('/api/debtors', (req, res) => getApi(req, res, 'Debtors'));
app.delete('/api/debtors/:id', (req, res) => deleteApi(req, res, 'Debtors'));
app.post('/api/debtors', async (req, res) => {
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
                .query(`UPDATE Debtors SET debtor=@debtor, amount=@amount, dueDate=@dueDate, description=@description, status=@status, clientId=@clientId WHERE id=@id`);
        } else {
            await pool.request()
                .input('id', sql.VarChar(50), d.id)
                .input('debtor', sql.VarChar(255), debtorName)
                .input('amount', sql.Decimal(18, 2), d.amount)
                .input('dueDate', sql.Date, dueDate)
                .input('description', sql.VarChar(sql.MAX), d.description || '')
                .input('status', sql.VarChar(50), d.status || 'pending')
                .input('clientId', sql.VarChar(50), d.clientId || null)
                .query(`INSERT INTO Debtors (id, debtor, amount, dueDate, description, status, clientId) VALUES (@id, @debtor, @amount, @dueDate, @description, @status, @clientId)`);
        }
        res.json(d);
    } catch (err) {
        console.error('Error in POST /api/debtors:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/debtors/:id/pay', async (req, res) => {
    try {
        const pool = await getDbPool();
        const debtorId = req.params.id;

        // Iniciar transacción explícita
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // 1. Obtener la deuda específica
            const debtorRes = await transaction.request()
                .input('id', sql.VarChar, debtorId)
                .query(`SELECT debtor, amount, description, clientId FROM Debtors WHERE id = @id`);

            if (debtorRes.recordset.length === 0) {
                await transaction.rollback();
                return res.status(404).json({ error: "Deudor no encontrado" });
            }

            const debtor = debtorRes.recordset[0];
            const clientIdToUse = debtor.clientId; // Siempre van a ser clientes registrados según clarif. usuario

            // 2. Crear movimiento en Transactions
            const moveId = 'T' + Date.now().toString() + Math.floor(Math.random() * 1000);
            const moveDate = new Date();
            const obsText = 'Pago deuda auto. Titular: ' + debtor.debtor + ' - Detalle: ' + (debtor.description || '');

            await transaction.request()
                .input('id', sql.VarChar, moveId)
                .input('date', sql.Date, moveDate)
                .input('type', sql.VarChar, 'income')
                .input('conceptId', sql.VarChar, '1') // Concepto fijo "Ventas" (se asume que su ID es 1 en la BD)
                .input('amount', sql.Decimal(18, 2), debtor.amount)
                .input('observation', sql.VarChar(sql.MAX), obsText)
                .input('clientId', sql.VarChar, clientIdToUse)
                .query(`INSERT INTO Transactions (id, date, type, conceptId, amount, observation, clientId) VALUES (@id, @date, @type, @conceptId, @amount, @observation, @clientId)`);

            // 3. Eliminar o actualizar en Debtors
            await transaction.request()
                .input('id', sql.VarChar, debtorId)
                .query(`DELETE FROM Debtors WHERE id = @id`);

            // NOTA: Si quisiéramos mantener el registro en Contratos/Historial lo dejamos intacto o actualizamos su status en ContractHistory
            // En este caso, actualizaremos contractHistory a Pagada
            await transaction.request()
                .input('debtorId', sql.VarChar, debtorId)
                .query(`UPDATE ContractHistory SET debtorId = NULL WHERE debtorId = @debtorId`); // O puedes poner un campo de status si existiera

            await transaction.commit();
            res.json({ success: true, message: 'Deuda liquidada y movimiento creado' });

        } catch (tErr) {
            await transaction.rollback();
            throw tErr;
        }

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- ENDPOINTS PARA GASTOS OPERACIONALES ---
app.get('/api/operational-expenses', (req, res) => getApi(req, res, 'dbo.[OperationalExpenses]'));
app.delete('/api/operational-expenses/:id', (req, res) => deleteApi(req, res, 'dbo.[OperationalExpenses]'));

app.post('/api/operational-expenses', async (req, res) => {
    console.log('--- [API] POST /api/operational-expenses RECEIVED ---');
    try {
        const e = req.body;
        console.log('Body:', JSON.stringify(e, null, 2));
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

app.post('/api/operational-expenses/:id/pay', async (req, res) => {
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
        
        // Calcular próxima fecha según frecuencia
        const lastNextDate = new Date(expense.nextPaymentDate);
        let newNextDate = new Date(lastNextDate);
        
        switch (expense.frequency) {
            case 'monthly': newNextDate.setMonth(newNextDate.getMonth() + 1); break;
            case 'quarterly': newNextDate.setMonth(newNextDate.getMonth() + 3); break;
            case 'semiannually': newNextDate.setMonth(newNextDate.getMonth() + 6); break;
            case 'yearly': newNextDate.setFullYear(newNextDate.getFullYear() + 1); break;
            default: newNextDate.setMonth(newNextDate.getMonth() + 1);
        }

        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // 1. Actualizar el gasto operacional
            await transaction.request()
                .input('id', sql.VarChar, expenseId)
                .input('lastPaymentDate', sql.Date, new Date())
                .input('nextPaymentDate', sql.Date, newNextDate)
                .query(`UPDATE dbo.[OperationalExpenses] SET lastPaymentDate = @lastPaymentDate, nextPaymentDate = @nextPaymentDate WHERE id = @id`);

            // 2. Crear movimiento en Transactions
            const moveId = 'T' + Date.now().toString();
            const obsText = expense.name; // El mismo nombre del gasto OP registrado
            const paidAmount = req.body.amount; // MONTO RECIBIDO DESDE EL CLIENTE
            
            await transaction.request()
                .input('id', sql.VarChar, moveId)
                .input('date', sql.Date, new Date())
                .input('type', sql.VarChar, 'expense')
                .input('conceptId', sql.VarChar, '1774961310024') // Concepto 'Gasto Operacional'
                .input('amount', sql.Decimal(18, 2), paidAmount)
                .input('observation', sql.VarChar(sql.MAX), obsText)
                .input('clientId', sql.VarChar, null)
                .input('supplierId', sql.VarChar, null)
                .query(`INSERT INTO Transactions (id, date, type, conceptId, amount, observation, clientId, supplierId) VALUES (@id, @date, @type, @conceptId, @amount, @observation, @clientId, @supplierId)`);

            await transaction.commit();
            res.json({ success: true, nextPaymentDate: newNextDate });
        } catch (tErr) {
            await transaction.rollback();
            throw tErr;
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- ENDPOINTS PARA AVAILABLES (DISPONIBLE) ---
app.get('/api/availables', (req, res) => getApi(req, res, 'Availables'));
app.delete('/api/availables/:id', (req, res) => deleteApi(req, res, 'Availables'));
app.post('/api/availables', async (req, res) => {
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
        res.json(a);
    } catch (err) {
        console.error('Error in POST /api/availables:', err);
        res.status(500).json({ error: err.message });
    }
});

// --- ENDPOINTS PARA USERS ---
app.get('/api/users', async (req, res) => {
    try {
        const pool = await getDbPool();
        const result = await pool.request().query('SELECT id, username, role, name, modules FROM Users');
        const users = result.recordset.map(u => ({
            ...u,
            modules: u.modules ? JSON.parse(u.modules) : []
        }));
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- ENDPOINTS PARA NOTAS (PRIVADAS) ---

app.get('/api/notes/:userId', async (req, res) => {
    try {
        const pool = await getDbPool();
        const result = await pool.request()
            .input('userId', sql.VarChar, req.params.userId)
            .query('SELECT * FROM Notes WHERE userId = @userId ORDER BY pinned DESC, lastModified DESC');
        
        // Convertir BIT a Boolean para el frontend
        const notes = result.recordset.map(n => ({
            ...n,
            pinned: n.pinned === true || n.pinned === 1,
            archived: n.archived === true || n.archived === 1,
            deleted: n.deleted === true || n.deleted === 1
        }));
        res.json(notes);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/notes', async (req, res) => {
    try {
        const n = req.body;
        const pool = await getDbPool();
        
        // El contenido puede ser JSON string (para listas) o texto plano
        const content = typeof n.content === 'object' ? JSON.stringify(n.content) : n.content;
        const lastModified = n.lastModified || new Date().toISOString();

        console.log(`📝 Recibida nota ID: ${n.id} (Archivada: ${n.archived}, Eliminada: ${n.deleted})`);

        const check = await pool.request()
            .input('id', sql.VarChar(50), n.id)
            .query('SELECT id FROM Notes WHERE id = @id');

        if (check.recordset.length > 0) {
            await pool.request()
                .input('id', sql.VarChar(50), n.id)
                .input('userId', sql.VarChar(50), n.userId)
                .input('title', sql.VarChar(255), n.title || '')
                .input('content', sql.VarChar(sql.MAX), content)
                .input('type', sql.VarChar(50), n.type || 'text')
                .input('pinned', sql.Bit, n.pinned ? 1 : 0)
                .input('archived', sql.Bit, n.archived ? 1 : 0)
                .input('deleted', sql.Bit, n.deleted ? 1 : 0)
                .input('deletedAt', sql.DateTime, n.deletedAt ? new Date(n.deletedAt) : null)
                .input('lastModified', sql.DateTime, new Date(lastModified))
                .query(`UPDATE Notes SET userId=@userId, title=@title, content=@content, type=@type, pinned=@pinned, archived=@archived, deleted=@deleted, deletedAt=@deletedAt, lastModified=@lastModified WHERE id=@id`);
            console.log(`✅ Nota ${n.id} actualizada.`);
        } else {
            await pool.request()
                .input('id', sql.VarChar(50), n.id)
                .input('userId', sql.VarChar(50), n.userId)
                .input('title', sql.VarChar(255), n.title || '')
                .input('content', sql.VarChar(sql.MAX), content)
                .input('type', sql.VarChar(50), n.type || 'text')
                .input('pinned', sql.Bit, n.pinned ? 1 : 0)
                .input('archived', sql.Bit, n.archived ? 1 : 0)
                .input('deleted', sql.Bit, n.deleted ? 1 : 0)
                .input('deletedAt', sql.DateTime, n.deletedAt ? new Date(n.deletedAt) : null)
                .input('lastModified', sql.DateTime, new Date(lastModified))
                .query(`INSERT INTO Notes (id, userId, title, content, type, pinned, archived, deleted, deletedAt, lastModified) VALUES (@id, @userId, @title, @content, @type, @pinned, @archived, @deleted, @deletedAt, @lastModified)`);
            console.log(`✅ Nota ${n.id} creada.`);
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/notes/migrate/:userId', async (req, res) => {
    try {
        const notes = req.body; // Array de notas
        const userId = req.params.userId;
        const pool = await getDbPool();
        
        console.log(`Migrando ${notes.length} notas para usuario ${userId}`);

        for (const n of notes) {
            const content = typeof n.content === 'object' ? JSON.stringify(n.content) : n.content;
            const lastModified = n.lastModified || new Date().toISOString();
            
            // Asegurar que n.id es una cadena para SQL y manejar IDs numéricos de localStorage
            const noteIdStr = String(n.id);
            
            const check = await pool.request().input('id', sql.VarChar(50), noteIdStr).query('SELECT id FROM Notes WHERE id = @id');
            const finalId = check.recordset.length > 0 ? 'MIG-' + Date.now() + Math.random() : noteIdStr;

            await pool.request()
                .input('id', sql.VarChar(50), finalId)
                .input('userId', sql.VarChar(50), userId)
                .input('title', sql.VarChar(255), n.title || '')
                .input('content', sql.VarChar(sql.MAX), content)
                .input('type', sql.VarChar(50), n.type || 'text')
                .input('pinned', sql.Bit, n.pinned ? 1 : 0)
                .input('lastModified', sql.VarChar(100), lastModified)
                .query(`INSERT INTO Notes (id, userId, title, content, type, pinned, lastModified) VALUES (@id, @userId, @title, @content, @type, @pinned, @lastModified)`);
        }
        res.json({ success: true, count: notes.length });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/notes/:id', async (req, res) => {
    try {
        const pool = await getDbPool();
        const noteId = req.params.id;

        // Verificar si ya está marcada como eliminada
        const check = await pool.request()
            .input('id', sql.VarChar(50), noteId)
            .query('SELECT deleted FROM Notes WHERE id = @id');

        if (check.recordset.length > 0 && check.recordset[0].deleted) {
            // Si ya está en la papelera, eliminar para siempre
            await pool.request()
                .input('id', sql.VarChar(50), noteId)
                .query('DELETE FROM Notes WHERE id = @id');
            res.json({ success: true, permanent: true });
        } else {
            // Si no está eliminada, mover a la papelera
            await pool.request()
                .input('id', sql.VarChar(50), noteId)
                .input('deletedAt', sql.DateTime, new Date())
                .query('UPDATE Notes SET deleted = 1, pinned = 0, deletedAt = @deletedAt WHERE id = @id');
            res.json({ success: true, permanent: false });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Función para eliminar notas de la papelera con más de 30 días
async function deleteExpiredNotes() {
    try {
        const pool = await getDbPool();
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const result = await pool.request()
            .input('thirtyDaysAgo', sql.DateTime, thirtyDaysAgo)
            .query('DELETE FROM Notes WHERE deleted = 1 AND deletedAt < @thirtyDaysAgo');
        
        if (result.rowsAffected[0] > 0) {
            console.log(`🧹 Limpieza: ${result.rowsAffected[0]} notas antiguas eliminadas permanentemente.`);
        }
    } catch (err) {
        console.error('⚠️ Error en limpieza de notas:', err.message);
    }
}
app.delete('/api/users/:id', (req, res) => deleteApi(req, res, 'Users'));

// Guardar/actualizar un único usuario (con hash de contraseña)
app.post('/api/users', async (req, res) => {
    try {
        const u = req.body;
        const pool = await getDbPool();
        const check = await pool.request().input('id', sql.VarChar(50), u.id).query('SELECT id, password FROM Users WHERE id = @id');

        let hashedPassword;
        if (u.password && u.password.trim() !== '') {
            // Nueva contraseña o primera vez: hashear
            hashedPassword = await bcrypt.hash(u.password, BCRYPT_ROUNDS);
        } else if (check.recordset.length > 0) {
            // Edición sin cambio de contraseña: conservar el hash actual
            hashedPassword = check.recordset[0].password;
        } else {
            return res.status(400).json({ error: 'La contraseña es obligatoria para usuarios nuevos' });
        }

        const modulesJson = JSON.stringify(u.modules || []);

        if (check.recordset.length > 0) {
            await pool.request()
                .input('id', sql.VarChar(50), u.id)
                .input('username', sql.VarChar(50), u.username)
                .input('password', sql.VarChar(100), hashedPassword)
                .input('role', sql.VarChar(50), u.role)
                .input('name', sql.VarChar(100), u.name)
                .input('modules', sql.VarChar(sql.MAX), modulesJson)
                .query(`UPDATE Users SET username=@username, password=@password, role=@role, name=@name, modules=@modules WHERE id=@id`);
        } else {
            await pool.request()
                .input('id', sql.VarChar(50), u.id)
                .input('username', sql.VarChar(50), u.username)
                .input('password', sql.VarChar(100), hashedPassword)
                .input('role', sql.VarChar(50), u.role)
                .input('name', sql.VarChar(100), u.name)
                .input('modules', sql.VarChar(sql.MAX), modulesJson)
                .query(`INSERT INTO Users (id, username, password, role, name, modules) VALUES (@id, @username, @password, @role, @name, @modules)`);
        }
        // Retornar sin contraseña
        res.json({ id: u.id, username: u.username, role: u.role, name: u.name, modules: u.modules || [] });
    } catch (err) {
        console.error('Error in POST /api/users:', err);
        res.status(500).json({ error: err.message });
    }
});

// Batch (legacy / inicialización): hashear contraseñas si aún no lo están
app.post('/api/users/batch', async (req, res) => {
    try {
        const usersArray = req.body;
        const pool = await getDbPool();
        await pool.request().query('DELETE FROM Users');
        for (let u of usersArray) {
            // Si la contraseña ya es un hash bcrypt, no volver a hashear
            const alreadyHashed = u.password && u.password.startsWith('$2b$');
            const hashedPassword = alreadyHashed ? u.password : await bcrypt.hash(u.password, BCRYPT_ROUNDS);
            await pool.request()
                .input('id', sql.VarChar(50), u.id)
                .input('username', sql.VarChar(50), u.username)
                .input('password', sql.VarChar(100), hashedPassword)
                .input('role', sql.VarChar(50), u.role)
                .input('name', sql.VarChar(100), u.name)
                .input('modules', sql.VarChar(sql.MAX), JSON.stringify(u.modules || []))
                .query(`INSERT INTO Users (id, username, password, role, name, modules) VALUES (@id, @username, @password, @role, @name, @modules)`);
        }
        res.json(usersArray);
    } catch (err) {
        console.error('Error in POST /api/users/batch:', err);
        res.status(500).json({ error: err.message });
    }
});

// --- ENDPOINT DE AUTENTICACIÓN ---
app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ error: 'Credenciales requeridas' });

        const pool = await getDbPool();
        const result = await pool.request()
            .input('username', sql.VarChar(50), username.toLowerCase())
            .query('SELECT * FROM Users WHERE username = @username');

        if (result.recordset.length === 0) {
            return res.status(401).json({ error: 'Usuario no encontrado' });
        }

        const user = result.recordset[0];
        const isMatch = await bcrypt.compare(password, user.password);

        if (!isMatch) {
            return res.status(401).json({ error: 'Contraseña incorrecta' });
        }

        // No enviar la contraseña al cliente
        res.json({
            id: user.id,
            username: user.username,
            role: user.role,
            name: user.name,
            modules: user.modules ? JSON.parse(user.modules) : []
        });
    } catch (err) {
        console.error('Error in POST /api/auth/login:', err);
        res.status(500).json({ error: err.message });
    }
});

// Migrar contraseñas de texto plano a hash bcrypt (se llama al iniciar el servidor)
async function migratePasswords() {
    try {
        const pool = await getDbPool();
        const result = await pool.request().query('SELECT id, password FROM Users');
        let migrated = 0;
        for (const user of result.recordset) {
            if (!user.password || user.password.startsWith('$2b$')) continue;
            const hashed = await bcrypt.hash(user.password, BCRYPT_ROUNDS);
            await pool.request()
                .input('id', sql.VarChar(50), user.id)
                .input('password', sql.VarChar(100), hashed)
                .query('UPDATE Users SET password = @password WHERE id = @id');
            migrated++;
        }
        if (migrated > 0) {
            console.log(`✅ Migración: ${migrated} contraseña(s) convertida(s) a hash bcrypt`);
        } else {
            console.log('✅ Contraseñas: todas ya tienen hash bcrypt');
        }
    } catch (err) {
        console.error('⚠️  Error en migración de contraseñas:', err.message);
    }
}

// --- ENDPOINTS PARA CONTRACTS ---
app.get('/api/contracts', (req, res) => getApi(req, res, 'Contracts'));
app.delete('/api/contracts/:id', async (req, res) => {
    try {
        const pool = await getDbPool();
        // Borrar primero el historial para no violar la llave foránea
        await pool.request()
            .input('id', sql.VarChar, req.params.id)
            .query('DELETE FROM ContractHistory WHERE contractId = @id');

        await pool.request()
            .input('id', sql.VarChar, req.params.id)
            .query('DELETE FROM Contracts WHERE id = @id');

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.post('/api/contracts', async (req, res) => {
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

app.get('/api/uf', async (req, res) => {
    const uf = await fetchUF();
    if (uf) res.json({ valor: uf });
    else res.status(500).json({ error: "No se pudo obtener el valor de la UF" });
});

app.get('/api/contracts/pending', async (req, res) => {
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

app.post('/api/contracts/:id/invoice', async (req, res) => {
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

        const amountFinal = Math.round(amount * 1.19); // Aplicar 19% IVA

        await pool.request()
            .input('id', sql.VarChar(50), contractId)
            .input('period', sql.VarChar(50), currentPeriod)
            .query(`UPDATE Contracts SET lastInvoicedPeriod = @period WHERE id = @id`);

        // Integración Módulo Deudores (Vencimiento INMEDIATO: hoy)
        const dueDate = new Date();
        const newDebtorId = 'D' + Date.now().toString() + Math.floor(Math.random() * 1000);

        // Determinar nombre del periodo (YYYY-MM para consistencia)
        const periodNameStr = currentPeriod;
        const descriptionStr = `Mensualidad Contrato ${currentPeriod} (INC. IVA)`;

        await pool.request()
            .input('id', sql.VarChar(50), newDebtorId)
            .input('debtor', sql.VarChar(255), debtorName)
            .input('amount', sql.Decimal(18, 2), amountFinal)
            .input('dueDate', sql.Date, dueDate)
            .input('description', sql.VarChar(sql.MAX), descriptionStr)
            .input('status', sql.VarChar(50), 'pending')
            .query(`INSERT INTO Debtors (id, debtor, amount, dueDate, description, status) VALUES (@id, @debtor, @amount, @dueDate, @description, @status)`);

        // Registrar en Historial de Contratos (ContractHistory)
        const historyId = 'CH' + Date.now().toString() + Math.floor(Math.random() * 1000);

        await pool.request()
            .input('id', sql.VarChar(50), historyId)
            .input('contractId', sql.VarChar(50), contractId)
            .input('clientId', sql.VarChar(50), contract.clientId || '')
            .input('periodName', sql.VarChar(100), periodNameStr)
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

app.get('/api/contracts/invoiced-history', async (req, res) => {
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

// Mantener alias para compatibilidad mientras se migra el frontend
app.get('/api/contracts/invoiced-current', (req, res) => {
    // Redirigir a la nueva ruta que devuelve todo el historial
    res.redirect('/api/contracts/invoiced-history');
});


app.post('/api/contracts/:id/undo', async (req, res) => {
    try {
        const pool = await getDbPool();
        const contractId = req.params.id;

        // 1. Obtener el historial más reciente de este contrato para saber qué deudor borrar
        const historyRes = await pool.request()
            .input('contractId', sql.VarChar, contractId)
            .query(`SELECT TOP 1 id, debtorId, periodName FROM ContractHistory WHERE contractId = @contractId ORDER BY issueDate DESC`);

        if (historyRes.recordset.length > 0) {
            const history = historyRes.recordset[0];

            // 2. Eliminar el registro del historial
            await pool.request()
                .input('id', sql.VarChar, history.id)
                .query(`DELETE FROM ContractHistory WHERE id = @id`);

            // 3. Eliminar la deuda generada automáticamente en Debtors
            if (history.debtorId) {
                await pool.request()
                    .input('debtorId', sql.VarChar, history.debtorId)
                    .query(`DELETE FROM Debtors WHERE id = @debtorId`);
            }
        }

        // 4. Limpiar lastInvoicedPeriod del contrato (para que vuelva a salir en "Pendientes de Mes")
        await pool.request()
            .input('id', sql.VarChar, contractId)
            .query(`UPDATE Contracts SET lastInvoicedPeriod = '' WHERE id = @id`);

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Endpoint para obtener el historial de contratos de un cliente
app.get('/api/contracts/history/:clientId', async (req, res) => {
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

// --- ENDPOINTS PARA PROJECTS ---

app.delete('/api/projects/:id', async (req, res) => {
    try {
        const pool = await getDbPool();
        // Borrar historial primero para evitar error de FK
        await pool.request()
            .input('projectId', sql.VarChar(50), req.params.id)
            .query('DELETE FROM ProjectHistory WHERE projectId = @projectId');
        await pool.request()
            .input('id', sql.VarChar(50), req.params.id)
            .query('DELETE FROM Projects WHERE id = @id');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/projects', async (req, res) => {
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

app.get('/api/projects/:id/history', async (req, res) => {
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

app.post('/api/projects/:id/history', async (req, res) => {
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

app.delete('/api/projects/history/:id', async (req, res) => {
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

app.put('/api/projects/history/:id', async (req, res) => {
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

// --- ENDPOINTS PARA DISPONIBLE ---
app.get('/api/availables', async (req, res) => {
    try {
        const pool = await getDbPool();
        const result = await pool.request().query('SELECT * FROM AvailableFunds');
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/availables', async (req, res) => {
    try {
        const a = req.body;
        const pool = await getDbPool();
        const request = pool.request()
            .input('id', sql.VarChar(50), a.id)
            .input('location', sql.VarChar(255), a.location)
            .input('classification', sql.VarChar(50), a.classification)
            .input('instrument', sql.VarChar(100), a.instrument || null)
            .input('amount', sql.Decimal(18, 2), a.amount)
            .input('placementDate', sql.Date, a.placementDate || null)
            .input('dueDate', sql.Date, a.dueDate || null)
            .input('observation', sql.VarChar(sql.MAX), a.observation || '');

        await request.query(`
            IF EXISTS (SELECT 1 FROM AvailableFunds WHERE id = @id)
                UPDATE AvailableFunds SET 
                    location = @location, 
                    classification = @classification, 
                    instrument = @instrument, 
                    amount = @amount, 
                    placementDate = @placementDate, 
                    dueDate = @dueDate, 
                    observation = @observation 
                WHERE id = @id
            ELSE
                INSERT INTO AvailableFunds (id, location, classification, instrument, amount, placementDate, dueDate, observation) 
                VALUES (@id, @location, @classification, @instrument, @amount, @placementDate, @dueDate, @observation)
        `);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/availables/:id', async (req, res) => {
    try {
        const pool = await getDbPool();
        await pool.request()
            .input('id', sql.VarChar(50), req.params.id)
            .query('DELETE FROM AvailableFunds WHERE id = @id');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- ENDPOINTS PARA COTIZACIONES ---

// Limpiar cotizaciones antiguas (> 90 días)
async function cleanOldQuotations() {
    try {
        const pool = await getDbPool();
        const result = await pool.request().query('DELETE FROM Quotations WHERE createdAt < DATEADD(day, -90, GETDATE())');
        if (result.rowsAffected[0] > 0) {
            console.log(`🧹 Limpieza: Se eliminaron ${result.rowsAffected[0]} cotizaciones antiguas de la BD.`);
        }
    } catch (err) {
        console.error('Error en limpieza de cotizaciones:', err);
    }
}

app.get('/api/quotations', async (req, res) => {
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

app.get('/api/quotations/next-id/:prefixOrId/:year', async (req, res) => {
    try {
        const year = parseInt(req.params.year);
        let prefix = req.params.prefixOrId;
        
        // Si el 'prefix' es un UUID o muy largo, es probable que sea el clientId (código viejo)
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
        // Búsqueda estricta que incluya el prefijo y el año para evitar falsos positivos
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

app.get('/api/quotations/next-version/:id', async (req, res) => {
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

app.post('/api/quotations', async (req, res) => {
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
                        itemsOptional = @itemsOptional, subtotal = @subtotal, iva = @iva, total = @total
                WHEN NOT MATCHED THEN
                    INSERT (id, correlative, year, version, clientId, clientName, projectName, requirements, technicalConditions, commercialConditions, items1, itemsOptional, subtotal, iva, total, createdAt)
                    VALUES (@id, @correlative, @year, @version, @clientId, @clientName, @projectName, @requirements, @technicalConditions, @commercialConditions, @items1, @itemsOptional, @subtotal, @iva, @total, GETDATE());
            `);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/quotations/:id/:version', async (req, res) => {
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

app.post('/api/quotations/save-pdf', async (req, res) => {
    try {
        const { clientName, year, quotationId, pdfBase64 } = req.body;
        
        // Ruta Base en OneDrive
        const baseDriveDir = path.join('C:', 'Users', 'Richard', 'OneDrive - SIMONS SPA', 'Simons SPA', 'Clientes', 'Cotizaciones APP');
        const yearDir = path.join(baseDriveDir, year.toString());
        const clientDir = path.join(yearDir, clientName);
        
        // Crear directorios si no existen
        if (!fs.existsSync(baseDriveDir)) fs.mkdirSync(baseDriveDir, { recursive: true });
        if (!fs.existsSync(yearDir)) fs.mkdirSync(yearDir, { recursive: true });
        if (!fs.existsSync(clientDir)) fs.mkdirSync(clientDir, { recursive: true });

        // Limpiar base64 header si existe de manera robusta
        const base64Data = pdfBase64.includes('base64,') ? pdfBase64.split('base64,')[1] : pdfBase64;
        
        const fileName = `Cotizacion_${quotationId}_${clientName.replace(/[^a-zA-Z0-9 -]/g, '')}.pdf`;
        const filePath = path.join(clientDir, fileName);

        fs.writeFileSync(filePath, base64Data, 'base64');
        
        console.log(`✅ PDF cotización guardado: ${filePath}`);
        res.json({ success: true, filePath });
    } catch (err) {
        console.error('Error al guardar PDF:', err);
        res.status(500).json({ error: err.message });
    }
});

// --- ENDPOINTS PARA LOGS ---
app.get('/api/logs', async (req, res) => {
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
app.post('/api/logs', async (req, res) => {
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

const PORT = 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor iniciado y accesible en red local`);
    console.log(`🏠 Local: http://localhost:${PORT}`);
    console.log(`🌐 Red:  http://192.168.130.129:${PORT}`);
    
    // Tareas de mantenimiento (envueltas para evitar bloqueos)
    setTimeout(async () => {
        try {
            await migratePasswords();
            await deleteExpiredNotes();
            await cleanOldQuotations();
        } catch (mErr) {
            console.error('⚠️ Error en tareas de mantenimiento iniciales:', mErr.message);
        }
    }, 5000); // 5 segundos para asegurar estabilidad inicial
});

// Manejo global de errores para evitar cierres inesperados
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught Exception:', err);
    // En producción podrías querer cerrar ordenadamente, pero aquí evitamos el loop de crash directo
    // process.exit(1); 
});

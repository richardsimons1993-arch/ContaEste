const express = require('express');
const cors = require('cors');
const sql = require('mssql/msnodesqlv8');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname)); // Sirve HTML, JS y CSS automáticamente

// Configuración de Conexión a SQL Server usando driver nativo (para evitar problemas de TCP/IP)
const dbConfig = {
    connectionString: 'Driver={ODBC Driver 18 for SQL Server};Server=localhost\\SIMONS;Database=ContabilidadDB;UID=sa;PWD=S0p0rt3!!2025;Encrypt=yes;TrustServerCertificate=yes;'
};

let poolPromise = new sql.ConnectionPool(dbConfig)
    .connect()
    .then(pool => {
        console.log('✅ Conectado a SQL Server Express');
        return pool;
    })
    .catch(err => console.error('❌ Error conectando a SQL Server: ', err));

// Rutas Genéricas
const getApi = async (req, res, table) => {
    try {
        const pool = await poolPromise;
        let query = `SELECT * FROM ${table}`;

        // Aliases para compatibilidad con el frontend
        if (table === 'Clients') query = `SELECT *, name as razonSocial FROM Clients`;
        if (table === 'Debts') query = `SELECT *, creditor as titular, dueDate as date FROM Debts`;
        if (table === 'Debtors') query = `SELECT *, debtor as titular, dueDate as date FROM Debtors`;

        const result = await pool.request().query(query);
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

const deleteApi = async (req, res, table) => {
    try {
        const pool = await poolPromise;
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
        const pool = await poolPromise;

        // Validar tipo según concepto (Seguridad extra)
        const conceptCheck = await pool.request()
            .input('cid', sql.VarChar, t.conceptId)
            .query('SELECT type FROM Concepts WHERE id = @cid');

        const finalType = conceptCheck.recordset.length > 0 ? conceptCheck.recordset[0].type : t.type;

        const check = await pool.request().input('id', sql.VarChar, t.id).query('SELECT id FROM Transactions WHERE id = @id');

        if (check.recordset.length > 0) {
            await pool.request()
                .input('id', sql.VarChar, t.id)
                .input('date', sql.Date, t.date)
                .input('type', sql.VarChar, finalType)
                .input('conceptId', sql.VarChar, t.conceptId)
                .input('clientId', sql.VarChar, t.clientId)
                .input('amount', sql.Decimal(18, 2), t.amount)
                .input('observation', sql.VarChar(sql.MAX), t.observation)
                .query(`UPDATE Transactions SET date=@date, type=@type, conceptId=@conceptId, clientId=@clientId, amount=@amount, observation=@observation WHERE id=@id`);
        } else {
            await pool.request()
                .input('id', sql.VarChar, t.id)
                .input('date', sql.Date, t.date)
                .input('type', sql.VarChar, finalType)
                .input('conceptId', sql.VarChar, t.conceptId)
                .input('clientId', sql.VarChar, t.clientId)
                .input('amount', sql.Decimal(18, 2), t.amount)
                .input('observation', sql.VarChar(sql.MAX), t.observation)
                .query(`INSERT INTO Transactions (id, date, type, conceptId, clientId, amount, observation) VALUES (@id, @date, @type, @conceptId, @clientId, @amount, @observation)`);
        }
        res.json({ ...t, type: finalType });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// --- ENDPOINTS PARA CONCEPTS ---
app.get('/api/concepts', (req, res) => getApi(req, res, 'Concepts'));
app.delete('/api/concepts/:id', (req, res) => deleteApi(req, res, 'Concepts'));
app.post('/api/concepts', async (req, res) => {
    try {
        const c = req.body;
        const pool = await poolPromise;
        const check = await pool.request().input('id', sql.VarChar, c.id).query('SELECT id FROM Concepts WHERE id = @id');
        if (check.recordset.length > 0) {
            await pool.request()
                .input('id', sql.VarChar, c.id)
                .input('name', sql.VarChar, c.name)
                .input('type', sql.VarChar, c.type)
                .query(`UPDATE Concepts SET name=@name, type=@type WHERE id=@id`);
        } else {
            await pool.request()
                .input('id', sql.VarChar, c.id)
                .input('name', sql.VarChar, c.name)
                .input('type', sql.VarChar, c.type)
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
        const pool = await poolPromise;
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
        const pool = await poolPromise;
        const clientId = c.id;

        const check = await pool.request().input('id', sql.VarChar, clientId).query('SELECT id FROM Clients WHERE id = @id');

        const clientName = c.razonSocial || c.name || 'Sin Nombre';

        if (check.recordset.length > 0) {
            await pool.request()
                .input('id', sql.VarChar, clientId)
                .input('name', sql.VarChar, clientName)
                .input('nombreFantasia', sql.VarChar, c.nombreFantasia || null)
                .input('rut', sql.VarChar, c.rut || null)
                .input('encargado', sql.VarChar, c.encargado || null)
                .input('phone', sql.VarChar, c.telefono || null)
                .input('email', sql.VarChar, c.correo || null)
                .input('address', sql.VarChar, c.direccion || null)
                .query(`UPDATE Clients SET name=@name, nombreFantasia=@nombreFantasia, rut=@rut, encargado=@encargado, phone=@phone, email=@email, address=@address WHERE id=@id`);
        } else {
            await pool.request()
                .input('id', sql.VarChar, clientId)
                .input('name', sql.VarChar, clientName)
                .input('nombreFantasia', sql.VarChar, c.nombreFantasia || null)
                .input('rut', sql.VarChar, c.rut || null)
                .input('encargado', sql.VarChar, c.encargado || null)
                .input('phone', sql.VarChar, c.telefono || null)
                .input('email', sql.VarChar, c.correo || null)
                .input('address', sql.VarChar, c.direccion || null)
                .query(`INSERT INTO Clients (id, name, nombreFantasia, rut, encargado, phone, email, address) VALUES (@id, @name, @nombreFantasia, @rut, @encargado, @phone, @email, @address)`);
        }
        res.json({ success: true, id: clientId });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- ENDPOINTS PARA DEBTS ---
app.get('/api/debts', (req, res) => getApi(req, res, 'Debts'));
app.delete('/api/debts/:id', (req, res) => deleteApi(req, res, 'Debts'));
app.post('/api/debts', async (req, res) => {
    try {
        const d = req.body;
        const pool = await poolPromise;
        const check = await pool.request().input('id', sql.VarChar, d.id).query('SELECT id FROM Debts WHERE id = @id');
        if (check.recordset.length > 0) {
            await pool.request()
                .input('id', sql.VarChar, d.id)
                .input('creditor', sql.VarChar, d.creditor)
                .input('amount', sql.Decimal(18, 2), d.amount)
                .input('dueDate', sql.Date, d.dueDate)
                .input('description', sql.VarChar(sql.MAX), d.description || '')
                .input('status', sql.VarChar, d.status || 'pending')
                .query(`UPDATE Debts SET creditor=@creditor, amount=@amount, dueDate=@dueDate, description=@description, status=@status WHERE id=@id`);
        } else {
            await pool.request()
                .input('id', sql.VarChar, d.id)
                .input('creditor', sql.VarChar, d.creditor)
                .input('amount', sql.Decimal(18, 2), d.amount)
                .input('dueDate', sql.Date, d.dueDate)
                .input('description', sql.VarChar(sql.MAX), d.description || '')
                .input('status', sql.VarChar, d.status || 'pending')
                .query(`INSERT INTO Debts (id, creditor, amount, dueDate, description, status) VALUES (@id, @creditor, @amount, @dueDate, @description, @status)`);
        }
        res.json(d);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- ENDPOINTS PARA DEBTORS ---
app.get('/api/debtors', (req, res) => getApi(req, res, 'Debtors'));
app.delete('/api/debtors/:id', (req, res) => deleteApi(req, res, 'Debtors'));
app.post('/api/debtors', async (req, res) => {
    try {
        const d = req.body;
        const pool = await poolPromise;
        const check = await pool.request().input('id', sql.VarChar, d.id).query('SELECT id FROM Debtors WHERE id = @id');
        if (check.recordset.length > 0) {
            await pool.request()
                .input('id', sql.VarChar, d.id)
                .input('debtor', sql.VarChar, d.debtor)
                .input('amount', sql.Decimal(18, 2), d.amount)
                .input('dueDate', sql.Date, d.dueDate)
                .input('description', sql.VarChar(sql.MAX), d.description || '')
                .input('status', sql.VarChar, d.status || 'pending')
                .query(`UPDATE Debtors SET debtor=@debtor, amount=@amount, dueDate=@dueDate, description=@description, status=@status WHERE id=@id`);
        } else {
            await pool.request()
                .input('id', sql.VarChar, d.id)
                .input('debtor', sql.VarChar, d.debtor)
                .input('amount', sql.Decimal(18, 2), d.amount)
                .input('dueDate', sql.Date, d.dueDate)
                .input('description', sql.VarChar(sql.MAX), d.description || '')
                .input('status', sql.VarChar, d.status || 'pending')
                .query(`INSERT INTO Debtors (id, debtor, amount, dueDate, description, status) VALUES (@id, @debtor, @amount, @dueDate, @description, @status)`);
        }
        res.json(d);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- ENDPOINTS PARA USERS ---
app.get('/api/users', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query('SELECT * FROM Users');
        const users = result.recordset.map(u => ({
            ...u,
            modules: u.modules ? JSON.parse(u.modules) : []
        }));
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.delete('/api/users/:id', (req, res) => deleteApi(req, res, 'Users'));
app.post('/api/users/batch', async (req, res) => {
    try {
        const usersArray = req.body;
        const pool = await poolPromise;
        await pool.request().query('DELETE FROM Users');
        for (let u of usersArray) {
            await pool.request()
                .input('id', sql.VarChar, u.id)
                .input('username', sql.VarChar, u.username)
                .input('password', sql.VarChar, u.password)
                .input('role', sql.VarChar, u.role)
                .input('name', sql.VarChar, u.name)
                .input('modules', sql.VarChar, JSON.stringify(u.modules || []))
                .query(`INSERT INTO Users (id, username, password, role, name, modules) VALUES (@id, @username, @password, @role, @name, @modules)`);
        }
        res.json(usersArray);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- ENDPOINTS PARA LOGS ---
app.get('/api/logs', async (req, res) => {
    try {
        const pool = await poolPromise;
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
        const pool = await poolPromise;
        await pool.request()
            .input('id', sql.VarChar, l.id)
            .input('action', sql.VarChar, l.action)
            .input('module', sql.VarChar, l.module)
            .input('userName', sql.VarChar, l.userName || 'Sistema')
            .input('details', sql.VarChar(sql.MAX), l.details || '')
            .input('timestamp', sql.DateTime, new Date(l.timestamp))
            .input('extraData', sql.VarChar(sql.MAX), l.extraData ? JSON.stringify(l.extraData) : null)
            .query(`INSERT INTO Logs (id, action, module, userName, details, timestamp, extraData) VALUES (@id, @action, @module, @userName, @details, @timestamp, @extraData)`);
        res.json(l);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor iniciado y accesible en red local`);
    console.log(`🏠 Local: http://localhost:${PORT}`);
    console.log(`🌐 Red:  http://192.168.130.129:${PORT}`);
});

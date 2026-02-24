const express = require('express');
const cors = require('cors');
const sql = require('mssql');

const app = express();
app.use(cors());
app.use(express.json());

// Configuración de Conexión a SQL Server
const dbConfig = {
    user: 'sa',
    password: 'S0p0rt3!!2025',
    server: 'localhost',
    port: 64514,
    database: 'ContabilidadDB',
    options: {
        encrypt: true,
        trustServerCertificate: true // Importante para desarrollo local
    }
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
        const result = await pool.request().query(`SELECT * FROM ${table}`);

        // Formatear las fechas para que no incluyan la hora si no es necesario o en formato correcto
        // Esto depende de cómo lo consuma app.js
        const records = result.recordset;
        // Algunas transformaciones pueden ser necesarias...
        res.json(records);
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

        // Si editando (en Contabilidad, el app.js podría borrar y re-crear o simplemente pasar id existente)
        // Usamos upsert
        const check = await pool.request().input('id', sql.VarChar, t.id).query('SELECT id FROM Transactions WHERE id = @id');

        if (check.recordset.length > 0) {
            await pool.request()
                .input('id', sql.VarChar, t.id)
                .input('date', sql.Date, t.date)
                .input('type', sql.VarChar, t.type)
                .input('conceptId', sql.VarChar, t.conceptId)
                .input('clientId', sql.VarChar, t.clientId)
                .input('amount', sql.Decimal(18, 2), t.amount)
                .input('observation', sql.Text, t.observation)
                .query(`UPDATE Transactions SET date=@date, type=@type, conceptId=@conceptId, clientId=@clientId, amount=@amount, observation=@observation WHERE id=@id`);
        } else {
            await pool.request()
                .input('id', sql.VarChar, t.id)
                .input('date', sql.Date, t.date)
                .input('type', sql.VarChar, t.type)
                .input('conceptId', sql.VarChar, t.conceptId)
                .input('clientId', sql.VarChar, t.clientId)
                .input('amount', sql.Decimal(18, 2), t.amount)
                .input('observation', sql.Text, t.observation)
                .query(`INSERT INTO Transactions (id, date, type, conceptId, clientId, amount, observation) VALUES (@id, @date, @type, @conceptId, @clientId, @amount, @observation)`);
        }
        res.json(t);
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
app.get('/api/clients', (req, res) => getApi(req, res, 'Clients'));
app.delete('/api/clients/:id', (req, res) => deleteApi(req, res, 'Clients'));
app.post('/api/clients', async (req, res) => {
    try {
        const c = req.body;
        const pool = await poolPromise;
        const check = await pool.request().input('id', sql.VarChar, c.id).query('SELECT id FROM Clients WHERE id = @id');
        if (check.recordset.length > 0) {
            await pool.request()
                .input('id', sql.VarChar, c.id)
                .input('name', sql.VarChar, c.name)
                .input('phone', sql.VarChar, c.phone || null)
                .input('email', sql.VarChar, c.email || null)
                .input('address', sql.VarChar, c.address || null)
                .query(`UPDATE Clients SET name=@name, phone=@phone, email=@email, address=@address WHERE id=@id`);
        } else {
            await pool.request()
                .input('id', sql.VarChar, c.id)
                .input('name', sql.VarChar, c.name)
                .input('phone', sql.VarChar, c.phone || null)
                .input('email', sql.VarChar, c.email || null)
                .input('address', sql.VarChar, c.address || null)
                .query(`INSERT INTO Clients (id, name, phone, email, address) VALUES (@id, @name, @phone, @email, @address)`);
        }
        res.json(c);
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
                .input('description', sql.Text, d.description || '')
                .input('status', sql.VarChar, d.status || 'pending')
                .query(`UPDATE Debts SET creditor=@creditor, amount=@amount, dueDate=@dueDate, description=@description, status=@status WHERE id=@id`);
        } else {
            await pool.request()
                .input('id', sql.VarChar, d.id)
                .input('creditor', sql.VarChar, d.creditor)
                .input('amount', sql.Decimal(18, 2), d.amount)
                .input('dueDate', sql.Date, d.dueDate)
                .input('description', sql.Text, d.description || '')
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
                .input('description', sql.Text, d.description || '')
                .input('status', sql.VarChar, d.status || 'pending')
                .query(`UPDATE Debtors SET debtor=@debtor, amount=@amount, dueDate=@dueDate, description=@description, status=@status WHERE id=@id`);
        } else {
            await pool.request()
                .input('id', sql.VarChar, d.id)
                .input('debtor', sql.VarChar, d.debtor)
                .input('amount', sql.Decimal(18, 2), d.amount)
                .input('dueDate', sql.Date, d.dueDate)
                .input('description', sql.Text, d.description || '')
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
    // storage.js saveUsers guarda todos de una vez.
    try {
        const usersArray = req.body;
        const pool = await poolPromise;

        // Limpiamos la tabla y volvemos a insertar (para simplificar la sincronización del array de users)
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
        // Obtenemos ordenados descendente
        const result = await pool.request().query('SELECT TOP 100 * FROM Logs ORDER BY timestamp DESC');
        res.json(result.recordset);
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
            .input('details', sql.Text, l.details || '')
            .input('timestamp', sql.DateTime, new Date(l.timestamp))
            .query(`INSERT INTO Logs (id, action, module, details, timestamp) VALUES (@id, @action, @module, @details, @timestamp)`);

        res.json(l);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = 3000;
app.listen(PORT, () => console.log(`🚀 Servidor ejecutándose en el puerto ${PORT}`));

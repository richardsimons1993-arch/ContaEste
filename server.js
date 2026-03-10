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

// Rutas Genéricas
const getApi = async (req, res, table) => {
    try {
        const pool = await getDbPool();
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
        const pool = await getDbPool();

        // Validar tipo según concepto (Seguridad extra)
        const conceptCheck = await pool.request()
            .input('cid', sql.VarChar, t.conceptId)
            .query('SELECT type FROM Concepts WHERE id = @cid');

        const finalType = conceptCheck.recordset.length > 0 ? conceptCheck.recordset[0].type : t.type;

        const check = await pool.request().input('id', sql.VarChar(50), t.id).query('SELECT id FROM Transactions WHERE id = @id');

        if (check.recordset.length > 0) {
            await pool.request()
                .input('id', sql.VarChar(50), t.id)
                .input('date', sql.Date, t.date)
                .input('type', sql.VarChar(50), finalType)
                .input('conceptId', sql.VarChar(50), t.conceptId)
                .input('clientId', sql.VarChar(50), t.clientId)
                .input('amount', sql.Decimal(18, 2), t.amount)
                .input('observation', sql.VarChar(sql.MAX), t.observation)
                .query(`UPDATE Transactions SET date=@date, type=@type, conceptId=@conceptId, clientId=@clientId, amount=@amount, observation=@observation WHERE id=@id`);
        } else {
            await pool.request()
                .input('id', sql.VarChar(50), t.id)
                .input('date', sql.Date, t.date)
                .input('type', sql.VarChar(50), finalType)
                .input('conceptId', sql.VarChar(50), t.conceptId)
                .input('clientId', sql.VarChar(50), t.clientId)
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
                .query(`INSERT INTO Transactions (id, date, type, conceptId, amount, observation, clientId) VALUES (@id, @date, @type, @conceptId, @amount, @observation, @clientId)`);

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
                .query(`UPDATE Debtors SET debtor=@debtor, amount=@amount, dueDate=@dueDate, description=@description, status=@status WHERE id=@id`);
        } else {
            await pool.request()
                .input('id', sql.VarChar(50), d.id)
                .input('debtor', sql.VarChar(255), debtorName)
                .input('amount', sql.Decimal(18, 2), d.amount)
                .input('dueDate', sql.Date, dueDate)
                .input('description', sql.VarChar(sql.MAX), d.description || '')
                .input('status', sql.VarChar(50), d.status || 'pending')
                .query(`INSERT INTO Debtors (id, debtor, amount, dueDate, description, status) VALUES (@id, @debtor, @amount, @dueDate, @description, @status)`);
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
                .query(`SELECT debtor, amount, description FROM Debtors WHERE id = @id`);

            if (debtorRes.recordset.length === 0) {
                await transaction.rollback();
                return res.status(404).json({ error: "Deudor no encontrado" });
            }

            const debtor = debtorRes.recordset[0];

            // 1b. Intentar obtener clientId desde ContractHistory
            const chRes = await transaction.request()
                .input('debtorId', sql.VarChar, debtorId)
                .query(`SELECT clientId FROM ContractHistory WHERE debtorId = @debtorId`);

            let clientIdToUse = null;
            if (chRes.recordset.length > 0 && chRes.recordset[0].clientId) {
                clientIdToUse = chRes.recordset[0].clientId;
            } else {
                // Si no fue autogenerado por contrato, intentamos buscar por nombre exacto
                const clRes = await transaction.request()
                    .input('name', sql.VarChar, debtor.debtor)
                    .query(`SELECT id FROM Clients WHERE name = @name`);
                if (clRes.recordset.length > 0) {
                    clientIdToUse = clRes.recordset[0].id;
                }
            }

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

// --- ENDPOINTS PARA USERS ---
app.get('/api/users', async (req, res) => {
    try {
        const pool = await getDbPool();
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
        const pool = await getDbPool();
        await pool.request().query('DELETE FROM Users');
        for (let u of usersArray) {
            await pool.request()
                .input('id', sql.VarChar(50), u.id)
                .input('username', sql.VarChar(50), u.username)
                .input('password', sql.VarChar(100), u.password)
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
        const check = await pool.request().input('id', sql.VarChar(50), c.id).query('SELECT id FROM Contracts WHERE id = @id');
        if (check.recordset.length > 0) {
            await pool.request()
                .input('id', sql.VarChar(50), c.id)
                .input('clientId', sql.VarChar(50), c.clientId)
                .input('amount', sql.Decimal(18, 2), c.amount)
                .input('startDate', sql.Date, c.startDate)
                .input('endDate', sql.Date, c.endDate)
                .input('billingDay', sql.Int, c.billingDay)
                .input('frequency', sql.VarChar(50), c.frequency || 'mensual')
                .input('lastInvoicedPeriod', sql.VarChar(50), c.lastInvoicedPeriod || '')
                .query(`UPDATE Contracts SET clientId=@clientId, amount=@amount, startDate=@startDate, endDate=@endDate, billingDay=@billingDay, frequency=@frequency, lastInvoicedPeriod=@lastInvoicedPeriod WHERE id=@id`);
        } else {
            await pool.request()
                .input('id', sql.VarChar(50), c.id)
                .input('clientId', sql.VarChar(50), c.clientId)
                .input('amount', sql.Decimal(18, 2), c.amount)
                .input('startDate', sql.Date, c.startDate)
                .input('endDate', sql.Date, c.endDate)
                .input('billingDay', sql.Int, c.billingDay)
                .input('frequency', sql.VarChar(50), c.frequency || 'mensual')
                .input('lastInvoicedPeriod', sql.VarChar(50), c.lastInvoicedPeriod || '')
                .query(`INSERT INTO Contracts (id, clientId, amount, startDate, endDate, billingDay, frequency, lastInvoicedPeriod) VALUES (@id, @clientId, @amount, @startDate, @endDate, @billingDay, @frequency, @lastInvoicedPeriod)`);
        }
        res.json(c);
    } catch (err) {
        console.error('Error in POST /api/contracts:', err);
        res.status(500).json({ error: err.message });
    }
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
              AND endDate >= @currentDate
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
            .query(`SELECT c.amount, c.clientId, cl.name as clientName 
                    FROM Contracts c
                    LEFT JOIN Clients cl ON c.clientId = cl.id
                    WHERE c.id = @id`);

        if (contractRes.recordset.length === 0) {
            return res.status(404).json({ error: "Contrato no encontrado" });
        }

        const contract = contractRes.recordset[0];
        const debtorName = contract.clientName || 'Cliente Desconocido';
        const amount = contract.amount;

        await pool.request()
            .input('id', sql.VarChar(50), contractId)
            .input('period', sql.VarChar(50), currentPeriod)
            .query(`UPDATE Contracts SET lastInvoicedPeriod = @period WHERE id = @id`);

        // Integración Módulo Deudores (Vencimiento INMEDIATO: hoy)
        const dueDate = new Date();
        const newDebtorId = 'D' + Date.now().toString() + Math.floor(Math.random() * 1000);

        // Determinar nombre del mes
        const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
        const periodNameStr = `${monthNames[now.getMonth()]} ${currentYear}`;
        const descriptionStr = `Outsourcing Mes ${monthNames[now.getMonth()]}`;

        await pool.request()
            .input('id', sql.VarChar(50), newDebtorId)
            .input('debtor', sql.VarChar(255), debtorName)
            .input('amount', sql.Decimal(18, 2), amount)
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
            .input('amount', sql.Decimal(18, 2), amount)
            .input('debtorId', sql.VarChar(50), newDebtorId)
            .query(`INSERT INTO ContractHistory (id, contractId, clientId, periodName, issueDate, amount, debtorId) VALUES (@id, @contractId, @clientId, @periodName, @issueDate, @amount, @debtorId)`);

        res.json({ success: true, period: currentPeriod });
    } catch (err) {
        console.error('Error in POST /api/contracts/:id/invoice:', err);
        res.status(500).json({ error: err.message });
    }
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
});

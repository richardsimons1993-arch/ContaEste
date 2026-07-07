const sql = require('mssql');

const dbConfig = {
    user: process.env.DB_USER || 'SA',
    password: process.env.DB_PASSWORD || 'S0p0rt3!!2025',
    server: process.env.DB_SERVER || 'localhost',
    database: process.env.DB_NAME || process.env.DB_DATABASE || 'ContabilidadDB',
    options: {
        encrypt: process.env.DB_ENCRYPT === 'true',
        trustServerCertificate: true
    }
};

let poolPromise = null;

function getDbPool() {
    if (!poolPromise) {
        const pool = new sql.ConnectionPool(dbConfig);
        pool.on('error', err => {
            console.error('❌ Error en el pool de base de datos:', err);
            poolPromise = null; // Reset pool promise on pool error so it reconnects on next request
        });
        poolPromise = pool.connect()
            .then(connectedPool => {
                console.log('✅ Conectado a SQL Server (ContabilidadDB)');
                return connectedPool;
            })
            .catch(err => {
                console.error('❌ Error conectando a SQL Server: ', err);
                poolPromise = null;
                throw err;
            });
    }
    return poolPromise;
}

const getApi = async (req, res, table) => {
    try {
        const pool = await getDbPool();
        let query = `SELECT * FROM ${table}`;

        if (table === 'Clients') query = `SELECT *, name as razonSocial FROM Clients`;
        if (table === 'Debts') query = `SELECT *, creditor as titular, dueDate as date FROM Debts`;
        if (table === 'Debtors') query = `SELECT *, debtor as titular, dueDate as date FROM Debtors`;
        if (table === 'Availables') query = `SELECT * FROM Availables`;

        const result = await pool.request().query(query);
        res.json(result.recordset);
    } catch (err) {
        console.error(`Error en getApi(${table}):`, err.message);
        res.status(500).json({ error: 'Error interno del servidor.' });
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
        console.error(`Error en deleteApi(${table}):`, err.message);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
};

module.exports = {
    sql,
    dbConfig,
    getDbPool,
    getApi,
    deleteApi
};

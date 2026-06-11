const sql = require('mssql');

const config = {
    user: 'sa',
    password: 'S0p0rt3!!2025',
    server: 'localhost',
    database: 'ContabilidadDB',
    options: {
        encrypt: false,
        trustServerCertificate: true
    }
};Server=localhost\\SIMONS;Database=ContabilidadDB;UID=sa;PWD=S0p0rt3!!2025;Encrypt=yes;TrustServerCertificate=yes;'
};

async function checkRecent() {
    try {
        let pool = await sql.connect(config);
        // Intentar encontrar transacciones con IDs numéricos altos (recientes)
        const result = await pool.request().query('SELECT * FROM Transactions WHERE id LIKE \'177367%\' ORDER BY id DESC');
        console.log('Recent transactions by ID:');
        console.table(result.recordset);
        await pool.close();
    } catch (err) {
        console.error('Error:', err.message);
    }
}

checkRecent();

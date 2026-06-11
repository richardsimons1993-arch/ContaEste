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

async function listUsers() {
    try {
        await sql.connect(config);
        const result = await sql.query('SELECT id, username, role, name FROM Users');
        console.log('Users in database:');
        console.table(result.recordset);
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await sql.close();
    }
}
listUsers();

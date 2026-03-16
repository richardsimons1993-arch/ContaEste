const sql = require('mssql/msnodesqlv8');

const config = {
    connectionString: 'Driver={ODBC Driver 18 for SQL Server};Server=localhost\\SIMONS;Database=ContabilidadDB;UID=sa;PWD=S0p0rt3!!2025;Encrypt=yes;TrustServerCertificate=yes;'
};

async function verifyDb() {
    try {
        let pool = await sql.connect(config);
        const result = await pool.request().query('SELECT TOP 10 * FROM Transactions ORDER BY date DESC');
        console.log('Last 10 transactions:');
        console.table(result.recordset);
        await pool.close();
    } catch (err) {
        console.error('Error connecting to DB:', err.message);
    }
}

verifyDb();

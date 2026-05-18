const sql = require('mssql/msnodesqlv8');

const config = {
    connectionString: 'Driver={ODBC Driver 18 for SQL Server};Server=localhost\\SIMONS;Database=ContabilidadDB;UID=sa;PWD=S0p0rt3!!2025;Encrypt=yes;TrustServerCertificate=yes;'
};

async function checkDate() {
    try {
        let pool = await sql.connect(config);
        const result = await pool.request()
            .input('date', sql.Date, '2026-03-16')
            .query('SELECT * FROM Transactions WHERE date = @date ORDER BY id DESC');
        console.log('Transactions for 2026-03-16:');
        console.table(result.recordset);
        await pool.close();
    } catch (err) {
        console.error('Error:', err.message);
    }
}

checkDate();

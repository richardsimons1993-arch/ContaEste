const sql = require('mssql/msnodesqlv8');

const config = {
    connectionString: 'Driver={ODBC Driver 18 for SQL Server};Server=localhost\\SIMONS;Database=ContabilidadDB;UID=sa;PWD=S0p0rt3!!2025;Encrypt=yes;TrustServerCertificate=yes;'
};

async function verifyDb() {
    try {
        let pool = await sql.connect(config);
        const result = await pool.request().query("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE'");
        console.log('Tables in database:');
        console.table(result.recordset);
        await pool.close();
    } catch (err) {
        console.error('Error connecting to DB:', err.message);
    }
}

verifyDb();

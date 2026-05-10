const sql = require('mssql/msnodesqlv8');

const dbConfig = {
    connectionString: 'Driver={ODBC Driver 18 for SQL Server};Server=localhost\\SIMONS;Database=ContabilidadDB;UID=sa;PWD=S0p0rt3!!2025;Encrypt=yes;TrustServerCertificate=yes;'
};

async function clearQuotations() {
    try {
        console.log('Conectando a la base de datos (SIMONS)...');
        const pool = await new sql.ConnectionPool(dbConfig).connect();
        
        console.log('Borrando registros de la tabla Quotations...');
        const result = await pool.request().query('DELETE FROM Quotations');
        
        console.log(`✅ Éxito: Se eliminaron ${result.rowsAffected[0]} registros de cotizaciones.`);
        
        await pool.close();
    } catch (err) {
        console.error('❌ Error:', err.message);
    }
}

clearQuotations();

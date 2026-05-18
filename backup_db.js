const sql = require('mssql/msnodesqlv8');

const dbConfig = {
    connectionString: 'Driver={ODBC Driver 18 for SQL Server};Server=localhost\\SIMONS;Database=ContabilidadDB;UID=sa;PWD=S0p0rt3!!2025;Encrypt=yes;TrustServerCertificate=yes;'
};

async function backupDB() {
    try {
        console.log('Connecting to local DB to generate backup...');
        const pool = await new sql.ConnectionPool(dbConfig).connect();
        
        // Use a path where SQL Server has permissions, usually Public or C:\Temp
        const backupPath = 'C:\\Temp\\db_backup.bak';
        console.log(`Executing BACKUP command to: ${backupPath}`);
        
        // Provide the query
        await pool.request().query(`BACKUP DATABASE ContabilidadDB TO DISK='${backupPath}' WITH FORMAT, MEDIANAME='ContabilidadDBBackup', NAME='Full Backup of ContabilidadDB'`);
        
        console.log('✅ Backup successfully created at: ' + backupPath);
        pool.close();
    } catch (err) {
        console.error('❌ Error during backup:', err.message);
        process.exit(1);
    }
}

backupDB();

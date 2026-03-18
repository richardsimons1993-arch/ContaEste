const sql = require('mssql/msnodesqlv8');
const fs = require('fs');

const config = {
    connectionString: 'Driver={ODBC Driver 18 for SQL Server};Server=localhost\\SIMONS;Database=ContabilidadDB;UID=sa;PWD=S0p0rt3!!2025;Encrypt=yes;TrustServerCertificate=yes;'
};

async function runMigration() {
    try {
        console.log("Conectando a la DB...");
        await sql.connect(config);
        const migrationFile = process.argv[2] || 'update_db_v10.sql';
        console.log(`Leyendo script: ${migrationFile}`);
        const script = fs.readFileSync(migrationFile, 'utf8');
        
        // El script tiene GO, mssql no soporta GO nativamente. Hay que splitear.
        const commands = script.split(/\bGO\b/i);
        
        for (let cmd of commands) {
            if (cmd.trim()) {
                console.log("Ejecutando bloque...");
                await sql.query(cmd);
            }
        }
        
        console.log("Migración completada con éxito.");
    } catch (err) {
        console.error("Error en la migración:", err);
        process.exit(1);
    } finally {
        await sql.close();
    }
}

runMigration();

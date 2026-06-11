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
};Server=localhost\\SIMONS;Database=ContabilidadDB;UID=sa;PWD=S0p0rt3!!2025;Encrypt=yes;TrustServerCertificate=yes;' };
async function migrate() {
    try {
        await sql.connect(config);
        const result = await sql.query("SELECT id, password FROM Users WHERE username = 'administrador'");
        const user = result.recordset[0];
        if (user && !user.password.startsWith('$2b$')) {
            console.log('Hashing original admin password...');
            const hashed = await bcrypt.hash(user.password, 10);
            const pool = await sql.connect(config);
            await pool.request()
                .input('id', sql.VarChar, user.id)
                .input('password', sql.VarChar, hashed)
                .query("UPDATE Users SET password = @password WHERE id = @id");
            console.log('✅ Original admin password hashed successfully');
        } else {
            console.log('ℹ️  Original admin password already hashed or not found');
        }
    } catch (err) {
        console.error('Error migrating password:', err.message);
    } finally {
        await sql.close();
    }
}
migrate();

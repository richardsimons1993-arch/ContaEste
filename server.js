require("dotenv").config({ path: __dirname + "/.env" });
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

// Configuración global de directorios
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const app = express();

// Confiar en el proxy de Cloudflare para manejar HTTPS correctamente
app.set('trust proxy', true);

// --- CORS: solo permitir mismo origen ---
app.use(cors({ origin: false }));

// --- Cabeceras de seguridad HTTP básicas ---
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.removeHeader('X-Powered-By');
    next();
});

// --- Hardening de Seguridad: Bloquear descargas de código fuente y archivos de configuración ---
app.use((req, res, next) => {
    const pathToCheck = req.path.toLowerCase();
    if (pathToCheck.startsWith('/src') || 
        pathToCheck.includes('.env') || 
        pathToCheck.includes('package.json') || 
        pathToCheck.includes('config_crm.json') ||
        pathToCheck.includes('.git')
    ) {
        return res.status(403).send('Access Denied');
    }
    next();
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Servir archivos estáticos del frontend
app.use(express.static(__dirname, {
    setHeaders: (res, filePath) => {
        const normalizedPath = filePath.replace(/\\/g, '/');
        if (normalizedPath.includes('/vendor/')) {
            // Librerías de terceros: nunca cambian → caché agresivo de 1 año
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else if (filePath.endsWith('.html')) {
            // HTML: siempre revalidar para detectar cambios de versión
            res.setHeader('Cache-Control', 'no-cache, must-revalidate');
        } else if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
            // Código propio (usa ?v= en query string): no-cache, ETag sigue activo
            res.setHeader('Cache-Control', 'no-cache');
        }
    }
}));

// Servir directorio de uploads
app.use('/uploads', express.static(UPLOADS_DIR));

// Interceptar POST a la raíz o index.html
app.post(['/', '/index.html'], (req, res) => {
    res.redirect('/');
});

// Asegurar que GET / sirva el index.html explícitamente
app.get('/', (req, res) => {
    res.set('Cache-Control', 'no-cache, must-revalidate');
    res.sendFile(path.join(__dirname, 'index.html'));
});

// --- Middlewares de API ---
const { requireAuth, rbacMiddleware } = require('./src/middlewares/auth');
const auditLogMiddleware = require('./src/middlewares/audit');

// Rutas de API Públicas (Auth)
const authRouter = require('./src/routes/auth');
app.use('/api/auth', authRouter);

// Aplicar requireAuth, rbacMiddleware y auditLogMiddleware a las rutas privadas /api/
app.use('/api', requireAuth, rbacMiddleware, auditLogMiddleware);

// Rutas de API Privadas
const transactionsRouter = require('./src/routes/transactions');
const { router: projectsRouter, syncQuotationsToProjects } = require('./src/routes/projects');
const inventoryRouter = require('./src/routes/inventory');
const clientsRouter = require('./src/routes/clients');
const debtsRouter = require('./src/routes/debts');
const contractsRouter = require('./src/routes/contracts');
const { router: quotationsRouter, cleanOldQuotations } = require('./src/routes/quotations');
const reportsRouter = require('./src/routes/reports');
const usersRouter = require('./src/routes/users');
const { router: notesRouter, deleteExpiredNotes } = require('./src/routes/notes');
const logsRouter = require('./src/routes/logs');
const miscRouter = require('./src/routes/misc');
const crmRouter = require('./src/routes/crm');

app.use('/api/transactions', transactionsRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/inventory', inventoryRouter);
app.use('/api/clients', clientsRouter);
app.use('/api/contracts', contractsRouter);
app.use('/api', debtsRouter);
app.use('/api', usersRouter);
app.use('/api/quotations', quotationsRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/notes', notesRouter);
app.use('/api/logs', logsRouter);
app.use('/api', miscRouter);
app.use('/api/crm', crmRouter);

const { getDbPool, sql } = require('./src/config/db');

async function logSystemError(action, details, extraData = null) {
    try {
        const pool = await getDbPool();
        await pool.request()
            .input('id', sql.VarChar(50), Date.now().toString() + Math.floor(Math.random() * 1000).toString())
            .input('action', sql.VarChar(50), action)
            .input('module', sql.VarChar(50), 'System')
            .input('userName', sql.VarChar(100), 'Sistema')
            .input('details', sql.VarChar(sql.MAX), details)
            .input('timestamp', sql.DateTime, new Date())
            .input('extraData', sql.VarChar(sql.MAX), extraData ? JSON.stringify(extraData) : null)
            .query(`INSERT INTO Logs (id, action, module, userName, details, timestamp, extraData) VALUES (@id, @action, @module, @userName, @details, @timestamp, @extraData)`);
    } catch (dbErr) {
        console.error('Failed to log system error to DB:', dbErr.message);
    }
}

// Middleware de captura de errores global de Express
app.use((err, req, res, next) => {
    console.error('❌ Error capturado en Express:', err);
    
    // Registrar el error en la base de datos de manera asíncrona
    logSystemError('Error Express', `Error en la ruta ${req.method} ${req.originalUrl}: ${err.message}`, {
        method: req.method,
        url: req.originalUrl,
        body: req.body,
        query: req.query,
        stack: err.stack
    });

    res.status(500).json({ error: 'Error interno del servidor: ' + err.message });
});

// --- SERVIDORES Y TAREAS DE MANTENIMIENTO ---
const HTTP_PORT  = parseInt(process.env.PORT)        || 3000;
const HTTPS_PORT = parseInt(process.env.HTTPS_PORT)  || 3443;

function getNetworkIp() {
    try {
        const netInterfaces = require('os').networkInterfaces();
        for (const name of Object.keys(netInterfaces)) {
            for (const net of netInterfaces[name]) {
                if (net.family === 'IPv4' && !net.internal) return net.address;
            }
        }
    } catch(e) {}
    return '127.0.0.1';
}

async function runDatabaseMigrations() {
    try {
        const pool = await getDbPool();
        console.log('--- Ejecutando Migraciones de Base de Datos ---');
        
        await pool.request().query(`
            IF NOT EXISTS (
                SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
                WHERE TABLE_NAME = 'Quotations' AND COLUMN_NAME = 'status'
            )
            BEGIN
                ALTER TABLE Quotations ADD status VARCHAR(50) NOT NULL DEFAULT 'Emitida';
            END
        `);
        
        await pool.request().query(`
            IF NOT EXISTS (
                SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
                WHERE TABLE_NAME = 'Reports' AND COLUMN_NAME = 'status'
            )
            BEGIN
                ALTER TABLE Reports ADD status VARCHAR(50) NOT NULL DEFAULT 'Emitido';
            END
        `);
        
        console.log('✅ Migraciones de base de datos finalizadas con éxito.');
    } catch (err) {
        console.error('❌ Error ejecutando migraciones de base de datos:', err.message);
    }
}

async function runMaintenanceTasks() {
    try {
        console.log('--- Ejecutando Tareas de Mantenimiento Iniciales ---');
        await runDatabaseMigrations();
        await deleteExpiredNotes();
        await cleanOldQuotations();
        await syncQuotationsToProjects();
        
        // Limpieza automática de logs antiguos
        console.log('--- Iniciando Limpieza de Logs Antiguos (>30 días) ---');
        const pool = await getDbPool();
        const purgeRes = await pool.request().query('DELETE FROM Logs WHERE timestamp < DATEADD(day, -30, GETDATE())');
        console.log(`✅ Limpieza de logs completada. Registros eliminados: ${purgeRes.rowsAffected[0]}`);
    } catch (mErr) {
        console.error('⚠️ Error en tareas de mantenimiento iniciales:', mErr.message);
    }
}

// Iniciar servidor HTTPS
let httpsActive = false;
try {
    const pfxPath = path.join(__dirname, 'certificate.pfx');
    if (fs.existsSync(pfxPath)) {
        const httpsOptions = {
            pfx: fs.readFileSync(pfxPath),
            passphrase: process.env.CERT_PASSPHRASE || 'S0p0rt3!!2025'
        };
        const httpsServer = https.createServer(httpsOptions, app);
        httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
            const ip = getNetworkIp();
            console.log(`🔒 Servidor HTTPS iniciado`);
            console.log(`🏠 Local: https://localhost:${HTTPS_PORT}`);
            console.log(`🌐 Red:  https://${ip}:${HTTPS_PORT}`);
            httpsActive = true;
            setTimeout(runMaintenanceTasks, 5000);
        });
    } else {
        console.log('⚠️ No se encontró certificate.pfx. Solo HTTP disponible.');
    }
} catch (sslErr) {
    console.error('❌ Error al cargar certificado SSL:', sslErr.message);
    console.log('⚠️ El servidor HTTPS no pudo iniciarse. Solo HTTP disponible.');
}

// Servidor HTTP redirigiendo o sirviendo directamente
const httpApp = http.createServer((req, res) => {
    const forwardedProto = req.headers['x-forwarded-proto'];
    const cfRay           = req.headers['cf-ray'];
    const isProxiedHttps  = forwardedProto === 'https' || !!cfRay;

    console.log(`[HTTP Request] Path: ${req.url}, Host: ${req.headers.host}, x-forwarded-proto: ${forwardedProto}, cf-ray: ${cfRay}, isProxiedHttps: ${isProxiedHttps}`);

    if (httpsActive && !isProxiedHttps) {
        const host = (req.headers.host || 'localhost').replace(`:${HTTP_PORT}`, `:${HTTPS_PORT}`);
        res.writeHead(301, { Location: `https://${host}${req.url}` });
        res.end();
    } else {
        app(req, res);
    }
});

httpApp.listen(HTTP_PORT, '0.0.0.0', () => {
    const ip = getNetworkIp();
    if (httpsActive) {
        console.log(`↪️  HTTP:${HTTP_PORT} → redirige a HTTPS:${HTTPS_PORT}`);
    } else {
        console.log(`🚀 Servidor HTTP iniciado (sin HTTPS)`);
        console.log(`🏠 Local: http://localhost:${HTTP_PORT}`);
        console.log(`🌐 Red:  http://${ip}:${HTTP_PORT}`);
        setTimeout(runMaintenanceTasks, 5000);
    }
});

// Manejo global de errores
process.on('unhandledRejection', async (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    const reasonStr = reason instanceof Error ? reason.message : String(reason);
    const stack = reason instanceof Error ? reason.stack : null;
    try {
        await logSystemError('Error UnhandledRejection', `Promesa rechazada no manejada: ${reasonStr}`, {
            reason: reasonStr,
            stack
        });
    } catch (e) {
        console.error('Error logging unhandled rejection:', e);
    }
});

process.on('uncaughtException', async (err) => {
    console.error('❌ Uncaught Exception:', err);
    try {
        await logSystemError('Error UncaughtException', `Excepción no capturada en el proceso: ${err.message}`, {
            error: err.message,
            stack: err.stack
        });
    } catch (e) {
        console.error('Error writing uncaughtException log:', e);
    } finally {
        process.exit(1);
    }
});

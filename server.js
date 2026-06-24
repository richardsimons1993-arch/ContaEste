require("dotenv").config({ path: __dirname + "/.env" });
const express = require('express');
const cors = require('cors');
const sql = require('mssql');
const bcrypt = require('bcrypt');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const multer = require('multer');

const msal = require('@azure/msal-node');
const session = require('express-session');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'contaeste_super_secret_key_2026!';

const BCRYPT_ROUNDS = 10;
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// Asegurar que existe el directorio de uploads
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR);
}

// Configuración de Multer para subir imágenes
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ 
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) cb(null, true);
        else cb(new Error('Solo se permiten imágenes'), false);
    }
});

const uploadDocument = multer({
    storage,
    limits: { fileSize: 15 * 1024 * 1024 }, // 15MB limit for PDFs
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') cb(null, true);
        else cb(new Error('Solo se permiten archivos PDF'), false);
    }
});

const app = express();

// Confiar en el proxy de Cloudflare para manejar HTTPS correctamente
app.set('trust proxy', true);

// --- CORS: solo permitir mismo origen (no se necesita CORS para una app de red local) ---
app.use(cors({ origin: false }));

// --- Cabeceras de seguridad HTTP básicas (sin dependencias externas) ---
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.removeHeader('X-Powered-By');
    next();
});

app.use(express.json({ limit: '50mb' })); // Aumentado para soportar base64 grandes (PDF)
app.use(express.static(__dirname, {
    setHeaders: (res, path) => {
        if (path.endsWith('.html') || path.endsWith('.js') || path.endsWith('.css')) {
            res.setHeader('Cache-Control', 'no-cache, must-revalidate');
        }
    }
})); // Sirve HTML, JS y CSS automáticamente

// Interceptar POST a la raíz o index.html
app.post(['/', '/index.html'], (req, res) => {
    res.redirect('/');
});

// Asegurar que GET / sirva el index.html explícitamente
app.get('/', (req, res) => {
    res.set('Cache-Control', 'no-cache, must-revalidate');
    res.sendFile(path.join(__dirname, 'index.html'));
});

// --- SEGURIDAD: MIDDLEWARE DE AUTENTICACIÓN (JWT) ---
const requireAuth = (req, res, next) => {
    // Si la ruta es pública, dejamos pasar
    if (req.path.startsWith('/auth/')) return next();

    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({ error: 'Acceso Denegado: Falta token de autenticación MFA' });
    }

    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded; // inyecta { id, email, role, modules }
        next();
    } catch (err) {
        console.error('Error verificando JWT:', err.message);
        return res.status(401).json({ error: 'Acceso Denegado: Token inválido o expirado' });
    }
};

const requireModule = (moduleName) => {
    return (req, res, next) => {
        if (!req.user) return res.status(401).json({ error: 'No autenticado' });
        if (req.user.role === 'administrador') return next(); // Admin tiene acceso total
        if (req.user.modules && req.user.modules.includes(moduleName)) {
            return next();
        }
        return res.status(403).json({ error: `Acceso denegado. Se requiere el módulo: ${moduleName}` });
    };
};

const routeModuleMap = {
    '/api/transactions': 'finanzas',
    '/api/concepts': 'finanzas',
    '/api/clients': 'finanzas',
    '/api/debts': 'finanzas',
    '/api/debtors': 'finanzas',
    '/api/suppliers': 'finanzas',
    '/api/operational-expenses': 'finanzas',
    '/api/availables': 'finanzas',
    '/api/projects': 'proyectos',
    '/api/inventory': 'inventario',
    '/api/crm': 'crm',
    '/api/contracts': 'ventas',
    '/api/quotations': 'cotizaciones',
    '/api/reports': 'informes',
    '/api/users': 'usuarios',
    '/api/app-locations': 'usuarios',
    '/api/notes': 'notas'
};

const rbacMiddleware = (req, res, next) => {
    // Only restrict POST, PUT, DELETE. Allow GET for now so UI doesn't break, 
    // or restrict GET too if you want full lockdown. We'll restrict POST/PUT/DELETE primarily.
    if (req.method === 'GET') return next();
    if (req.path.startsWith('/api/auth/')) return next();
    if (req.path.startsWith('/api/logs')) return next(); // anyone can log

    if (!req.user) return res.status(401).json({ error: 'No autenticado' });
    if (req.user.role === 'administrador') return next();

    // Find the required module based on the path
    let requiredModule = null;
    for (const [route, mod] of Object.entries(routeModuleMap)) {
        if (req.path.startsWith(route)) {
            requiredModule = mod;
            break;
        }
    }

    if (requiredModule) {
        if (req.user.modules && req.user.modules.includes(requiredModule)) {
            return next();
        } else {
            console.warn(`[RBAC Bloqueado] ${req.user.email} intentó acceder a ${req.path} sin el módulo ${requiredModule}`);
            return res.status(403).json({ error: `Acceso denegado. Se requiere el módulo: ${requiredModule}` });
        }
    }

    // If no specific module mapped, allow or deny? We allow by default to not break unknowns
    next();
};

const auditLogMiddleware = async (req, res, next) => {
    res.on('finish', async () => {
        // Solo registrar escrituras exitosas (mutaciones)
        if (['POST', 'PUT', 'DELETE'].includes(req.method) && res.statusCode >= 200 && res.statusCode < 300) {
            if (req.path.startsWith('/api/logs') || req.path.startsWith('/api/auth')) return;

            try {
                const pool = await getDbPool();
                const userName = req.user ? req.user.email : 'System';
                const action = req.method;
                const moduleName = req.path.split('/')[2] || 'unknown'; // ej. /api/transactions -> transactions
                const details = `Path: ${req.path}`;
                const extraData = JSON.stringify({ body: req.body, query: req.query });

                await pool.request()
                    .input('id', sql.VarChar(50), Date.now().toString() + Math.floor(Math.random() * 1000).toString())
                    .input('action', sql.VarChar(50), action)
                    .input('module', sql.VarChar(50), moduleName)
                    .input('userName', sql.VarChar(100), userName)
                    .input('details', sql.VarChar(sql.MAX), details)
                    .input('timestamp', sql.DateTime, new Date())
                    .input('extraData', sql.VarChar(sql.MAX), extraData)
                    .query(`INSERT INTO Logs (id, action, module, userName, details, timestamp, extraData) VALUES (@id, @action, @module, @userName, @details, @timestamp, @extraData)`);
            } catch (err) {
                console.error('Error guardando AuditLog:', err.message);
            }
        }
    });
    next();
};

// Aplicar Auth, RBAC y AuditLogging a TODAS las rutas /api
app.use('/api', requireAuth, rbacMiddleware, auditLogMiddleware);

// Configuración de Conexión a SQL Server
const dbConfig = {
    user: 'SA',
    password: 'S0p0rt3!!2025',
    server: 'localhost',
    database: 'ContabilidadDB',
    options: {
        encrypt: false,
        trustServerCertificate: true
    }
};

// Helper para parsear fechas de forma robusta (DD-MM-YYYY o YYYY-MM-DD)
function tryParseDate(dateStr) {
    if (!dateStr) return null;
    if (dateStr instanceof Date) return isNaN(dateStr.getTime()) ? null : dateStr;

    let d;
    // Si ya viene como YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
        d = new Date(dateStr);
    } else {
        // Intentar DD-MM-YYYY
        const parts = dateStr.split('-');
        if (parts.length === 3 && parts[2].length === 4) {
            d = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
        } else {
            d = new Date(dateStr);
        }
    }

    return (d && !isNaN(d.getTime())) ? d : null;
}

let poolPromise = null;

function getDbPool() {
    if (!poolPromise) {
        const pool = new sql.ConnectionPool(dbConfig);
        pool.on('error', err => {
            console.error('❌ Error en el pool de base de datos:', err);
            poolPromise = null; // Reset pool promise on pool error so it reconnects on next request
        });
        poolPromise = pool.connect()
            .then(connectedPool => {
                console.log('✅ Conectado a SQL Server Express');
                return connectedPool;
            })
            .catch(err => {
                console.error('❌ Error conectando a SQL Server: ', err);
                poolPromise = null;
                throw err;
            });
    }
    return poolPromise;
}

// UF Cache
let cachedUF = {
    valor: null,
    timestamp: 0
};

// Dolar Cache
let cachedDolar = {
    valor: null,
    timestamp: 0
};

// Rate Limiter en memoria para el endpoint de login
// Previene ataques de fuerza bruta sin necesidad de dependencias externas
const loginAttempts = new Map();
const LOGIN_MAX_ATTEMPTS = 5;      // Máximo de intentos fallidos
const LOGIN_WINDOW_MS   = 5 * 60 * 1000; // Ventana de 5 minutos
const LOGIN_BLOCK_MS    = 10 * 60 * 1000; // Bloqueo de 10 minutos

function checkLoginRateLimit(ip) {
    const now = Date.now();
    const record = loginAttempts.get(ip);

    if (!record) return { blocked: false };

    // Si está bloqueado y el bloqueo no ha expirado
    if (record.blockedUntil && now < record.blockedUntil) {
        const remainingMs = record.blockedUntil - now;
        const remainingMin = Math.ceil(remainingMs / 60000);
        return { blocked: true, remainingMin };
    }

    // Expirar ventana de tiempo si ya pasó
    if (now - record.firstAttempt > LOGIN_WINDOW_MS) {
        loginAttempts.delete(ip);
        return { blocked: false };
    }

    return { blocked: false, attempts: record.attempts };
}

function recordFailedLogin(ip) {
    const now = Date.now();
    const record = loginAttempts.get(ip) || { attempts: 0, firstAttempt: now };
    record.attempts += 1;

    if (record.attempts >= LOGIN_MAX_ATTEMPTS) {
        record.blockedUntil = now + LOGIN_BLOCK_MS;
        console.warn(`⚠️  Login bloqueado temporalmente para IP: ${ip} (${record.attempts} intentos fallidos)`);
    }

    loginAttempts.set(ip, record);
}

function clearLoginAttempts(ip) {
    loginAttempts.delete(ip);
}

// Limpiar registros expirados cada 30 minutos para no acumular memoria
setInterval(() => {
    const now = Date.now();
    for (const [ip, record] of loginAttempts.entries()) {
        const expiry = record.blockedUntil || (record.firstAttempt + LOGIN_WINDOW_MS);
        if (now > expiry) loginAttempts.delete(ip);
    }
}, 30 * 60 * 1000);


// Memoria caché para tipos de cambio (duración de 1 hora)
let ratesCache = {
    uf: { value: null, timestamp: 0, apiFailed: false },
    dolar: { value: null, timestamp: 0, apiFailed: false }
};
const CACHE_DURATION_MS = 60 * 60 * 1000;

// Fetch UF from mindicador.cl
async function fetchUF() {
    const now = Date.now();
    if (ratesCache.uf.value && (now - ratesCache.uf.timestamp < CACHE_DURATION_MS)) {
        return ratesCache.uf.value;
    }
    try {
        const response = await axios.get('https://mindicador.cl/api/uf', { timeout: 5000 });
        if (response.data && response.data.serie && response.data.serie.length > 0) {
            const val = response.data.serie[0].valor;
            ratesCache.uf = { value: val, timestamp: now, apiFailed: false };
            console.log(`[API] UF obtenida de mindicador.cl: ${val}`);
            return val;
        }
        throw new Error('Formato de respuesta inválido de UF');
    } catch (error) {
        console.error('Error fetching UF from mindicador.cl:', error.message);
        ratesCache.uf.apiFailed = true;
    }
    return ratesCache.uf.value || 37800; // Retornar fallback
}

// Fetch Dolar from mindicador.cl
async function fetchDolar() {
    const now = Date.now();
    if (ratesCache.dolar.value && (now - ratesCache.dolar.timestamp < CACHE_DURATION_MS)) {
        return ratesCache.dolar.value;
    }
    try {
        const response = await axios.get('https://mindicador.cl/api/dolar', { timeout: 5000 });
        if (response.data && response.data.serie && response.data.serie.length > 0) {
            const val = response.data.serie[0].valor;
            ratesCache.dolar = { value: val, timestamp: now, apiFailed: false };
            console.log(`[API] Dolar obtenido de mindicador.cl: ${val}`);
            return val;
        }
        throw new Error('Formato de respuesta inválido de Dólar');
    } catch (error) {
        console.error('Error fetching Dolar from mindicador.cl:', error.message);
        ratesCache.dolar.apiFailed = true;
    }
    return ratesCache.dolar.value || 950; // Retornar fallback
}

// Rutas Genéricas
const getApi = async (req, res, table) => {
    try {
        const pool = await getDbPool();
        let query = `SELECT * FROM ${table}`;

        // Aliases para compatibilidad con el frontend
        if (table === 'Clients') query = `SELECT *, name as razonSocial FROM Clients`;
        if (table === 'Debts') query = `SELECT *, creditor as titular, dueDate as date FROM Debts`;
        if (table === 'Debtors') query = `SELECT *, debtor as titular, dueDate as date FROM Debtors`;
        if (table === 'Availables') query = `SELECT * FROM Availables`;

        const result = await pool.request().query(query);
        res.json(result.recordset);
    } catch (err) {
        console.error(`Error en getApi(${table}):`, err.message);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
};

const deleteApi = async (req, res, table) => {
    try {
        const pool = await getDbPool();
        await pool.request()
            .input('id', sql.VarChar, req.params.id)
            .query(`DELETE FROM ${table} WHERE id = @id`);
        res.json({ success: true });
    } catch (err) {
        console.error(`Error en deleteApi(${table}):`, err.message);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
};

// --- MÓDULO SOPORTE TI ---



// --- ENDPOINTS PARA TRANSACTIONS ---
app.get('/api/transactions', (req, res) => getApi(req, res, 'Transactions'));
app.delete('/api/transactions/:id', async (req, res) => {
    try {
        const pool = await getDbPool();
        
        // 1. Obtener invoicePath si existe para eliminarlo del almacenamiento remoto
        const result = await pool.request()
            .input('id', sql.VarChar(50), req.params.id)
            .query('SELECT invoicePath FROM Transactions WHERE id = @id');
        
        if (result.recordset.length > 0) {
            const invoicePath = result.recordset[0].invoicePath;
            if (invoicePath) {
                deleteRemoteFile(invoicePath); // Se ejecuta en segundo plano
            }
        }

        // 2. Eliminar de la base de datos
        await pool.request()
            .input('id', sql.VarChar(50), req.params.id)
            .query('DELETE FROM Transactions WHERE id = @id');

        res.json({ success: true });
    } catch (err) {
        console.error('Error al eliminar transacción:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/transactions', async (req, res) => {
    try {
        const t = req.body;
        console.log('--- POST /api/transactions ---');
        console.log('Body:', t);

        const pool = await getDbPool();

        // Validar tipo según concepto (Seguridad extra)
        let finalType = t.type;
        if (t.conceptId) {
            const conceptCheck = await pool.request()
                .input('cid', sql.VarChar, t.conceptId)
                .query('SELECT type FROM Concepts WHERE id = @cid');
            if (conceptCheck.recordset.length > 0) {
                finalType = conceptCheck.recordset[0].type;
            }
        }
        
        const finalDate = tryParseDate(t.date);

        if (!finalDate) {
            console.error('Error: Fecha inválida recibida:', t.date);
            return res.status(400).json({ error: 'Fecha inválida. Use formato YYYY-MM-DD o DD-MM-YYYY.' });
        }

        // Normalizar IDs vacíos a NULL para evitar errores de clave foránea o datos basura
        const cleanClientId = (t.clientId && t.clientId.trim() !== '') ? t.clientId : null;
        const cleanSupplierId = (t.supplierId && t.supplierId.trim() !== '') ? t.supplierId : null;

        const check = await pool.request().input('id', sql.VarChar(50), t.id).query('SELECT id FROM Transactions WHERE id = @id');

        if (check.recordset.length > 0) {
            console.log('Actualizando transacción existente:', t.id);
            await pool.request()
                .input('id', sql.VarChar(50), t.id)
                .input('date', sql.Date, finalDate)
                .input('type', sql.VarChar(50), finalType)
                .input('conceptId', sql.VarChar(50), t.conceptId)
                .input('clientId', sql.VarChar(50), cleanClientId)
                .input('supplierId', sql.VarChar(50), cleanSupplierId)
                .input('amount', sql.Decimal(18, 2), t.amount)
                .input('observation', sql.VarChar(sql.MAX), t.observation || '')
                .input('invoicePath', sql.VarChar(sql.MAX), t.invoicePath || null)
                .query(`UPDATE Transactions SET date=@date, type=@type, conceptId=@conceptId, clientId=@clientId, supplierId=@supplierId, amount=@amount, observation=@observation, invoicePath=COALESCE(@invoicePath, invoicePath) WHERE id=@id`);
        } else {
            console.log('Insertando nueva transacción:', t.id);
            await pool.request()
                .input('id', sql.VarChar(50), t.id)
                .input('date', sql.Date, finalDate)
                .input('type', sql.VarChar(50), finalType)
                .input('conceptId', sql.VarChar(50), t.conceptId)
                .input('clientId', sql.VarChar(50), cleanClientId)
                .input('supplierId', sql.VarChar(50), cleanSupplierId)
                .input('amount', sql.Decimal(18, 2), t.amount)
                .input('observation', sql.VarChar(sql.MAX), t.observation || '')
                .input('invoicePath', sql.VarChar(sql.MAX), t.invoicePath || null)
                .query(`INSERT INTO Transactions (id, date, type, conceptId, clientId, supplierId, amount, observation, invoicePath) VALUES (@id, @date, @type, @conceptId, @clientId, @supplierId, @amount, @observation, @invoicePath)`);
        }
        console.log('✅ Operación exitosa');
        res.json({ ...t, type: finalType, clientId: cleanClientId, supplierId: cleanSupplierId, invoicePath: t.invoicePath || null });
    } catch (err) {
        console.error('❌ ERROR en POST /api/transactions:', err.message);
        if (err.number) console.error('SQL Error Number:', err.number);
        res.status(500).json({ error: 'Error de servidor/BD: ' + err.message });
    }
});

// --- ENDPOINTS PARA PROJECTS ---
app.get('/api/projects', async (req, res) => {
    try {
        const pool = await getDbPool();
        const projectsRes = await pool.request().query('SELECT * FROM Projects');
        const historyRes = await pool.request().query('SELECT * FROM ProjectHistory ORDER BY changeDate DESC');
        
        const projects = projectsRes.recordset;
        const history = historyRes.recordset;

        // Mapear historial por ID de proyecto
        const historyMap = {};
        history.forEach(h => {
            if (!historyMap[h.projectId]) historyMap[h.projectId] = [];
            historyMap[h.projectId].push(h);
        });

        // Combinar datos
        const projectsWithHistory = projects.map(p => ({
            ...p,
            history: historyMap[p.id] || []
        }));

        res.json(projectsWithHistory);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.delete('/api/projects/:id', (req, res) => deleteApi(req, res, 'Projects'));

// --- ENDPOINTS PARA INVENTORY (INVENTARIO) ---
app.get('/api/inventory', (req, res) => getApi(req, res, 'Inventory'));
app.delete('/api/inventory/:id', (req, res) => deleteApi(req, res, 'Inventory'));
app.post('/api/inventory', async (req, res) => {
    try {
        const i = req.body;
        const pool = await getDbPool();
        const check = await pool.request().input('id', sql.VarChar(50), i.id).query('SELECT id FROM Inventory WHERE id = @id');

        if (check.recordset.length > 0) {
            await pool.request()
                .input('id', sql.VarChar(50), i.id)
                .input('product', sql.VarChar(255), i.product)
                .input('quantity', sql.Decimal(18, 2), i.quantity)
                .input('unitPrice', sql.Decimal(18, 2), i.unitPrice)
                .input('location', sql.VarChar(100), i.location)
                .query(`UPDATE Inventory SET product=@product, quantity=@quantity, unitPrice=@unitPrice, location=@location WHERE id=@id`);
        } else {
            await pool.request()
                .input('id', sql.VarChar(50), i.id)
                .input('product', sql.VarChar(255), i.product)
                .input('quantity', sql.Decimal(18, 2), i.quantity)
                .input('unitPrice', sql.Decimal(18, 2), i.unitPrice)
                .input('location', sql.VarChar(100), i.location)
                .query(`INSERT INTO Inventory (id, product, quantity, unitPrice, location) VALUES (@id, @product, @quantity, @unitPrice, @location)`);
        }
        res.json(i);
    } catch (err) {
        console.error('Error in POST /api/inventory:', err);
        res.status(500).json({ error: err.message });
    }
});

// --- ENDPOINTS PARA UBICACIONES (Globales) ---
app.get('/api/app-locations', (req, res) => getApi(req, res, 'AppLocations'));
app.delete('/api/app-locations/:id', (req, res) => deleteApi(req, res, 'AppLocations'));
app.post('/api/app-locations', async (req, res) => {
    try {
        const l = req.body;
        console.log('--- [API] POST /api/app-locations RECEIVED DATA: ---');
        console.log(JSON.stringify(l, null, 2));
        
        const pool = await getDbPool();
        const check = await pool.request().input('id', sql.VarChar(50), l.id).query('SELECT id FROM AppLocations WHERE id = @id');
        
        const typeToSave = l.type || 'inventory';
        console.log(`--- [API] Saving location ${l.name} with type: ${typeToSave}`);

        if (check.recordset.length > 0) {
            await pool.request()
                .input('id', sql.VarChar(50), l.id)
                .input('name', sql.VarChar(255), l.name)
                .input('type', sql.VarChar(50), typeToSave)
                .query(`UPDATE AppLocations SET name=@name, type=@type WHERE id=@id`);
        } else {
            await pool.request()
                .input('id', sql.VarChar(50), l.id)
                .input('name', sql.VarChar(255), l.name)
                .input('type', sql.VarChar(50), typeToSave)
                .query(`INSERT INTO AppLocations (id, name, type) VALUES (@id, @name, @type)`);
        }
        res.json(l);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- ENDPOINTS PARA INVENTORY HISTORY ---
app.get('/api/inventory/history', (req, res) => getApi(req, res, 'InventoryHistory ORDER BY timestamp DESC'));
app.post('/api/inventory/history', async (req, res) => {
    try {
        const h = req.body;
        const pool = await getDbPool();
        await pool.request()
            .input('id', sql.VarChar(50), h.id || Date.now().toString())
            .input('productId', sql.VarChar(50), h.productId)
            .input('productName', sql.VarChar(255), h.productName)
            .input('type', sql.VarChar(50), h.type)
            .input('origin', sql.VarChar(255), h.origin || null)
            .input('destination', sql.VarChar(255), h.destination || null)
            .input('quantityChange', sql.Decimal(18, 2), h.quantityChange || 0)
            .input('userId', sql.VarChar(50), h.userId || null)
            .input('userName', sql.VarChar(100), h.userName || null)
            .query(`INSERT INTO InventoryHistory (id, productId, productName, type, origin, destination, quantityChange, userId, userName) 
                    VALUES (@id, @productId, @productName, @type, @origin, @destination, @quantityChange, @userId, @userName)`);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- ENDPOINTS PARA CONCEPTS ---
app.get('/api/concepts', (req, res) => getApi(req, res, 'Concepts'));
app.delete('/api/concepts/:id', (req, res) => deleteApi(req, res, 'Concepts'));
app.post('/api/concepts', async (req, res) => {
    try {
        const c = req.body;
        const pool = await getDbPool();
        const check = await pool.request().input('id', sql.VarChar(50), c.id).query('SELECT id FROM Concepts WHERE id = @id');
        if (check.recordset.length > 0) {
            await pool.request()
                .input('id', sql.VarChar(50), c.id)
                .input('name', sql.VarChar(255), c.name)
                .input('type', sql.VarChar(50), c.type)
                .query(`UPDATE Concepts SET name=@name, type=@type WHERE id=@id`);
        } else {
            await pool.request()
                .input('id', sql.VarChar(50), c.id)
                .input('name', sql.VarChar(255), c.name)
                .input('type', sql.VarChar(50), c.type)
                .query(`INSERT INTO Concepts (id, name, type) VALUES (@id, @name, @type)`);
        }
        res.json(c);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- ENDPOINTS PARA CLIENTS ---
app.get('/api/clients', async (req, res) => {
    try {
        const pool = await getDbPool();
        const result = await pool.request().query('SELECT * FROM Clients');
        const clients = result.recordset.map(c => ({
            id: c.id,
            razonSocial: c.name,
            nombreFantasia: c.nombreFantasia,
            rut: c.rut,
            encargado: c.encargado,
            telefono: c.phone,
            correo: c.email,
            direccion: c.address
        }));
        res.json(clients);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/clients/:id', (req, res) => deleteApi(req, res, 'Clients'));

app.post('/api/clients', async (req, res) => {
    try {
        const c = req.body;
        const pool = await getDbPool();
        const clientId = c.id;

        const check = await pool.request().input('id', sql.VarChar(50), clientId).query('SELECT id FROM Clients WHERE id = @id');

        const clientName = c.razonSocial || c.name || 'Sin Nombre';

        if (check.recordset.length > 0) {
            await pool.request()
                .input('id', sql.VarChar(50), clientId)
                .input('name', sql.VarChar(255), clientName)
                .input('nombreFantasia', sql.VarChar(255), c.nombreFantasia || null)
                .input('rut', sql.VarChar(50), c.rut || null)
                .input('encargado', sql.VarChar(255), c.encargado || null)
                .input('phone', sql.VarChar(50), c.telefono || null)
                .input('email', sql.VarChar(255), c.correo || null)
                .input('address', sql.VarChar(255), c.direccion || null)
                .query(`UPDATE Clients SET name=@name, nombreFantasia=@nombreFantasia, rut=@rut, encargado=@encargado, phone=@phone, email=@email, address=@address WHERE id=@id`);
        } else {
            await pool.request()
                .input('id', sql.VarChar(50), clientId)
                .input('name', sql.VarChar(255), clientName)
                .input('nombreFantasia', sql.VarChar(255), c.nombreFantasia || null)
                .input('rut', sql.VarChar(50), c.rut || null)
                .input('encargado', sql.VarChar(255), c.encargado || null)
                .input('phone', sql.VarChar(50), c.telefono || null)
                .input('email', sql.VarChar(255), c.correo || null)
                .input('address', sql.VarChar(255), c.direccion || null)
                .query(`INSERT INTO Clients (id, name, nombreFantasia, rut, encargado, phone, email, address) VALUES (@id, @name, @nombreFantasia, @rut, @encargado, @phone, @email, @address)`);
        }
        res.json({ success: true, id: clientId });
    } catch (err) {
        console.error('Error in POST /api/clients:', err);
        res.status(500).json({ error: err.message });
    }
});

// --- ENDPOINTS PARA DEBTS ---
app.get('/api/debts', (req, res) => getApi(req, res, 'Debts'));
app.delete('/api/debts/:id', (req, res) => deleteApi(req, res, 'Debts'));
app.post('/api/debts', async (req, res) => {
    try {
        const d = req.body;
        const creditor = d.creditor || d.titular;
        const dueDate = d.dueDate || d.date;
        const pool = await getDbPool();
        const check = await pool.request().input('id', sql.VarChar, d.id).query('SELECT id FROM Debts WHERE id = @id');
        if (check.recordset.length > 0) {
            await pool.request()
                .input('id', sql.VarChar(50), d.id)
                .input('creditor', sql.VarChar(255), creditor)
                .input('amount', sql.Decimal(18, 2), d.amount)
                .input('dueDate', sql.Date, dueDate)
                .input('description', sql.VarChar(sql.MAX), d.description || '')
                .input('status', sql.VarChar(50), d.status || 'pending')
                .input('conceptId', sql.VarChar(50), d.conceptId || null)
                .input('supplierId', sql.VarChar(50), d.supplierId || null)
                .query(`UPDATE Debts SET creditor=@creditor, amount=@amount, dueDate=@dueDate, description=@description, status=@status, conceptId=@conceptId, supplierId=@supplierId WHERE id=@id`);
        } else {
            await pool.request()
                .input('id', sql.VarChar(50), d.id)
                .input('creditor', sql.VarChar(255), creditor)
                .input('amount', sql.Decimal(18, 2), d.amount)
                .input('dueDate', sql.Date, dueDate)
                .input('description', sql.VarChar(sql.MAX), d.description || '')
                .input('status', sql.VarChar(50), d.status || 'pending')
                .input('conceptId', sql.VarChar(50), d.conceptId || null)
                .input('supplierId', sql.VarChar(50), d.supplierId || null)
                .query(`INSERT INTO Debts (id, creditor, amount, dueDate, description, status, conceptId, supplierId) VALUES (@id, @creditor, @amount, @dueDate, @description, @status, @conceptId, @supplierId)`);
        }
        res.json(d);
    } catch (err) {
        console.error('Error in POST /api/debts:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/debts/:id/pay', async (req, res) => {
    try {
        const pool = await getDbPool();
        const debtId = req.params.id;

        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // 1. Obtener la deuda
            const debtRes = await transaction.request()
                .input('id', sql.VarChar, debtId)
                .query(`SELECT creditor, amount, description, conceptId, supplierId FROM Debts WHERE id = @id`);

            if (debtRes.recordset.length === 0) {
                await transaction.rollback();
                return res.status(404).json({ error: 'Deuda no encontrada' });
            }

            const debt = debtRes.recordset[0];
            const moveId = 'T' + Date.now().toString() + Math.floor(Math.random() * 1000);
            const moveDate = new Date();
            const obsText = 'Pago a proveedor: ' + debt.creditor + (debt.description ? ' - ' + debt.description : '');

            // Usar conceptId del registro o Ventas(1) como fallback
            const conceptIdToUse = debt.conceptId || '1';

            // 2. Crear movimiento (egreso)
            await transaction.request()
                .input('id', sql.VarChar, moveId)
                .input('date', sql.Date, moveDate)
                .input('type', sql.VarChar, 'expense')
                .input('conceptId', sql.VarChar, conceptIdToUse)
                .input('amount', sql.Decimal(18, 2), debt.amount)
                .input('observation', sql.VarChar(sql.MAX), obsText)
                .input('clientId', sql.VarChar, null)
                .input('supplierId', sql.VarChar, debt.supplierId || null)
                .query(`INSERT INTO Transactions (id, date, type, conceptId, amount, observation, clientId, supplierId) VALUES (@id, @date, @type, @conceptId, @amount, @observation, @clientId, @supplierId)`);

            // 3. Eliminar deuda
            await transaction.request()
                .input('id', sql.VarChar, debtId)
                .query(`DELETE FROM Debts WHERE id = @id`);

            await transaction.commit();
            res.json({ success: true, message: 'Deuda pagada y movimiento creado' });

        } catch (tErr) {
            await transaction.rollback();
            throw tErr;
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- ENDPOINTS PARA SUPPLIERS ---
app.get('/api/suppliers', (req, res) => getApi(req, res, 'Suppliers'));
app.delete('/api/suppliers/:id', (req, res) => deleteApi(req, res, 'Suppliers'));
app.post('/api/suppliers', async (req, res) => {
    try {
        const s = req.body;
        const pool = await getDbPool();
        const check = await pool.request().input('id', sql.VarChar(50), s.id).query('SELECT id FROM Suppliers WHERE id = @id');
        if (check.recordset.length > 0) {
            await pool.request()
                .input('id', sql.VarChar(50), s.id)
                .input('name', sql.VarChar(255), s.name)
                .input('rut', sql.VarChar(50), s.rut || '')
                .input('encargado', sql.VarChar(255), s.encargado || '')
                .input('phone', sql.VarChar(50), s.phone || '')
                .input('email', sql.VarChar(255), s.email || '')
                .input('address', sql.VarChar(255), s.address || '')
                .query(`UPDATE Suppliers SET name=@name, rut=@rut, encargado=@encargado, phone=@phone, email=@email, address=@address WHERE id=@id`);
        } else {
            await pool.request()
                .input('id', sql.VarChar(50), s.id)
                .input('name', sql.VarChar(255), s.name)
                .input('rut', sql.VarChar(50), s.rut || '')
                .input('encargado', sql.VarChar(255), s.encargado || '')
                .input('phone', sql.VarChar(50), s.phone || '')
                .input('email', sql.VarChar(255), s.email || '')
                .input('address', sql.VarChar(255), s.address || '')
                .query(`INSERT INTO Suppliers (id, name, rut, encargado, phone, email, address) VALUES (@id, @name, @rut, @encargado, @phone, @email, @address)`);
        }
        res.json(s);
    } catch (err) {
        console.error('Error in POST /api/suppliers:', err);
        res.status(500).json({ error: err.message });
    }
});

// --- ENDPOINTS PARA DEBTORS ---
app.get('/api/debtors', (req, res) => getApi(req, res, 'Debtors'));
app.delete('/api/debtors/:id', async (req, res) => {
    try {
        const pool = await getDbPool();
        
        // 1. Obtener invoicePath si existe para eliminarlo del almacenamiento remoto
        const result = await pool.request()
            .input('id', sql.VarChar(50), req.params.id)
            .query('SELECT invoicePath FROM Debtors WHERE id = @id');
        
        if (result.recordset.length > 0) {
            const invoicePath = result.recordset[0].invoicePath;
            if (invoicePath) {
                deleteRemoteFile(invoicePath); // Se ejecuta en segundo plano
            }
        }

        // 2. Eliminar de la base de datos
        await pool.request()
            .input('id', sql.VarChar(50), req.params.id)
            .query('DELETE FROM Debtors WHERE id = @id');

        res.json({ success: true });
    } catch (err) {
        console.error('Error al eliminar deudor:', err);
        res.status(500).json({ error: err.message });
    }
});
app.post('/api/debtors', async (req, res) => {
    try {
        const d = req.body;
        const debtorName = d.debtor || d.titular;
        const dueDate = d.dueDate || d.date;
        const pool = await getDbPool();
        const check = await pool.request().input('id', sql.VarChar(50), d.id).query('SELECT id FROM Debtors WHERE id = @id');
        if (check.recordset.length > 0) {
            await pool.request()
                .input('id', sql.VarChar(50), d.id)
                .input('debtor', sql.VarChar(255), debtorName)
                .input('amount', sql.Decimal(18, 2), d.amount)
                .input('dueDate', sql.Date, dueDate)
                .input('description', sql.VarChar(sql.MAX), d.description || '')
                .input('status', sql.VarChar(50), d.status || 'pending')
                .input('clientId', sql.VarChar(50), d.clientId || null)
                .input('invoicePath', sql.VarChar(sql.MAX), d.invoicePath || null)
                .query(`UPDATE Debtors SET debtor=@debtor, amount=@amount, dueDate=@dueDate, description=@description, status=@status, clientId=@clientId, invoicePath=@invoicePath WHERE id=@id`);
        } else {
            await pool.request()
                .input('id', sql.VarChar(50), d.id)
                .input('debtor', sql.VarChar(255), debtorName)
                .input('amount', sql.Decimal(18, 2), d.amount)
                .input('dueDate', sql.Date, dueDate)
                .input('description', sql.VarChar(sql.MAX), d.description || '')
                .input('status', sql.VarChar(50), d.status || 'pending')
                .input('clientId', sql.VarChar(50), d.clientId || null)
                .input('invoicePath', sql.VarChar(sql.MAX), d.invoicePath || null)
                .query(`INSERT INTO Debtors (id, debtor, amount, dueDate, description, status, clientId, invoicePath) VALUES (@id, @debtor, @amount, @dueDate, @description, @status, @clientId, @invoicePath)`);
        }
        res.json(d);
    } catch (err) {
        console.error('Error in POST /api/debtors:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/debtors/:id/pay', async (req, res) => {
    try {
        const pool = await getDbPool();
        const debtorId = req.params.id;

        // Iniciar transacción explícita
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // 1. Obtener la deuda específica
            const debtorRes = await transaction.request()
                .input('id', sql.VarChar, debtorId)
                .query(`SELECT debtor, amount, description, clientId FROM Debtors WHERE id = @id`);

            if (debtorRes.recordset.length === 0) {
                await transaction.rollback();
                return res.status(404).json({ error: "Deudor no encontrado" });
            }

            const debtor = debtorRes.recordset[0];
            const clientIdToUse = debtor.clientId; // Siempre van a ser clientes registrados según clarif. usuario

            // 2. Crear movimiento en Transactions
            const moveId = 'T' + Date.now().toString() + Math.floor(Math.random() * 1000);
            const moveDate = new Date();
            const obsText = 'Pago deuda auto. Titular: ' + debtor.debtor + ' - Detalle: ' + (debtor.description || '');

            await transaction.request()
                .input('id', sql.VarChar, moveId)
                .input('date', sql.Date, moveDate)
                .input('type', sql.VarChar, 'income')
                .input('conceptId', sql.VarChar, '1') // Concepto fijo "Ventas" (se asume que su ID es 1 en la BD)
                .input('amount', sql.Decimal(18, 2), debtor.amount)
                .input('observation', sql.VarChar(sql.MAX), obsText)
                .input('clientId', sql.VarChar, clientIdToUse)
                .query(`INSERT INTO Transactions (id, date, type, conceptId, amount, observation, clientId) VALUES (@id, @date, @type, @conceptId, @amount, @observation, @clientId)`);

            // 3. Eliminar o actualizar en Debtors
            await transaction.request()
                .input('id', sql.VarChar, debtorId)
                .query(`DELETE FROM Debtors WHERE id = @id`);

            // NOTA: Si quisiéramos mantener el registro en Contratos/Historial lo dejamos intacto o actualizamos su status en ContractHistory
            // En este caso, actualizaremos contractHistory a Pagada
            await transaction.request()
                .input('debtorId', sql.VarChar, debtorId)
                .query(`UPDATE ContractHistory SET debtorId = NULL WHERE debtorId = @debtorId`); // O puedes poner un campo de status si existiera

            await transaction.commit();
            res.json({ success: true, message: 'Deuda liquidada y movimiento creado' });

        } catch (tErr) {
            await transaction.rollback();
            throw tErr;
        }

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- ENDPOINTS PARA GASTOS OPERACIONALES ---
app.get('/api/operational-expenses', (req, res) => getApi(req, res, 'dbo.[OperationalExpenses]'));
app.delete('/api/operational-expenses/:id', (req, res) => deleteApi(req, res, 'dbo.[OperationalExpenses]'));

app.post('/api/operational-expenses', async (req, res) => {
    console.log('--- [API] POST /api/operational-expenses RECEIVED ---');
    try {
        const e = req.body;
        console.log('Body:', JSON.stringify(e, null, 2));
        const pool = await getDbPool();
        const check = await pool.request().input('id', sql.VarChar(50), e.id).query('SELECT id FROM dbo.[OperationalExpenses] WHERE id = @id');
        
        const lastPaymentDate = e.lastPaymentDate ? tryParseDate(e.lastPaymentDate) : null;
        const nextPaymentDate = e.nextPaymentDate ? tryParseDate(e.nextPaymentDate) : null;

        if (check.recordset.length > 0) {
            await pool.request()
                .input('id', sql.VarChar(50), e.id)
                .input('name', sql.VarChar(255), e.name)
                .input('amount', sql.Decimal(18, 2), e.amount)
                .input('frequency', sql.VarChar(50), e.frequency)
                .input('lastPaymentDate', sql.Date, lastPaymentDate)
                .input('nextPaymentDate', sql.Date, nextPaymentDate)
                .input('description', sql.VarChar(sql.MAX), e.description || '')
                .input('status', sql.VarChar(50), e.status || 'active')
                .query(`UPDATE dbo.[OperationalExpenses] SET name=@name, amount=@amount, frequency=@frequency, lastPaymentDate=@lastPaymentDate, nextPaymentDate=@nextPaymentDate, description=@description, status=@status WHERE id=@id`);
        } else {
            await pool.request()
                .input('id', sql.VarChar(50), e.id)
                .input('name', sql.VarChar(255), e.name)
                .input('amount', sql.Decimal(18, 2), e.amount)
                .input('frequency', sql.VarChar(50), e.frequency)
                .input('lastPaymentDate', sql.Date, lastPaymentDate)
                .input('nextPaymentDate', sql.Date, nextPaymentDate)
                .input('description', sql.VarChar(sql.MAX), e.description || '')
                .input('status', sql.VarChar(50), e.status || 'active')
                .query(`INSERT INTO dbo.[OperationalExpenses] (id, name, amount, frequency, lastPaymentDate, nextPaymentDate, description, status) VALUES (@id, @name, @amount, @frequency, @lastPaymentDate, @nextPaymentDate, @description, @status)`);
        }
        res.json(e);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/operational-expenses/:id/pay', async (req, res) => {
    try {
        const pool = await getDbPool();
        const expenseId = req.params.id;

        const expenseRes = await pool.request()
            .input('id', sql.VarChar, expenseId)
            .query(`SELECT * FROM dbo.[OperationalExpenses] WHERE id = @id`);

        if (expenseRes.recordset.length === 0) {
            return res.status(404).json({ error: 'Gasto no encontrado' });
        }

        const expense = expenseRes.recordset[0];
        if (!expense.nextPaymentDate) {
            return res.status(400).json({ error: 'El gasto no tiene una próxima fecha de pago definida' });
        }
        
        // Calcular próxima fecha según frecuencia
        const lastNextDate = new Date(expense.nextPaymentDate);
        let newNextDate = new Date(lastNextDate);
        
        switch (expense.frequency) {
            case 'monthly': newNextDate.setMonth(newNextDate.getMonth() + 1); break;
            case 'quarterly': newNextDate.setMonth(newNextDate.getMonth() + 3); break;
            case 'semiannually': newNextDate.setMonth(newNextDate.getMonth() + 6); break;
            case 'yearly': newNextDate.setFullYear(newNextDate.getFullYear() + 1); break;
            default: newNextDate.setMonth(newNextDate.getMonth() + 1);
        }

        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // 1. Actualizar el gasto operacional
            await transaction.request()
                .input('id', sql.VarChar, expenseId)
                .input('lastPaymentDate', sql.Date, new Date())
                .input('nextPaymentDate', sql.Date, newNextDate)
                .query(`UPDATE dbo.[OperationalExpenses] SET lastPaymentDate = @lastPaymentDate, nextPaymentDate = @nextPaymentDate WHERE id = @id`);

            // 2. Crear movimiento en Transactions
            const moveId = 'T' + Date.now().toString();
            const obsText = expense.name; // El mismo nombre del gasto OP registrado
            const paidAmount = req.body.amount; // MONTO RECIBIDO DESDE EL CLIENTE
            
            await transaction.request()
                .input('id', sql.VarChar, moveId)
                .input('date', sql.Date, new Date())
                .input('type', sql.VarChar, 'expense')
                .input('conceptId', sql.VarChar, '1774961310024') // Concepto 'Gasto Operacional'
                .input('amount', sql.Decimal(18, 2), paidAmount)
                .input('observation', sql.VarChar(sql.MAX), obsText)
                .input('clientId', sql.VarChar, null)
                .input('supplierId', sql.VarChar, null)
                .query(`INSERT INTO Transactions (id, date, type, conceptId, amount, observation, clientId, supplierId) VALUES (@id, @date, @type, @conceptId, @amount, @observation, @clientId, @supplierId)`);

            await transaction.commit();
            res.json({ success: true, nextPaymentDate: newNextDate });
        } catch (tErr) {
            await transaction.rollback();
            throw tErr;
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- ENDPOINTS PARA AVAILABLES (DISPONIBLE) ---
app.get('/api/availables', (req, res) => getApi(req, res, 'Availables'));
app.delete('/api/availables/:id', (req, res) => deleteApi(req, res, 'Availables'));
app.post('/api/availables', async (req, res) => {
    try {
        const a = req.body;
        const pool = await getDbPool();
        const check = await pool.request().input('id', sql.VarChar(50), a.id).query('SELECT id FROM Availables WHERE id = @id');
        
        const placementDate = a.placementDate ? tryParseDate(a.placementDate) : null;
        const dueDate = a.dueDate ? tryParseDate(a.dueDate) : null;

        if (check.recordset.length > 0) {
            await pool.request()
                .input('id', sql.VarChar(50), a.id)
                .input('location', sql.VarChar(255), a.location)
                .input('classification', sql.VarChar(50), a.classification)
                .input('instrument', sql.VarChar(100), a.instrument || null)
                .input('amount', sql.Decimal(18, 2), a.amount)
                .input('placementDate', sql.Date, placementDate)
                .input('dueDate', sql.Date, dueDate)
                .input('observation', sql.VarChar(sql.MAX), a.observation || '')
                .query(`UPDATE Availables SET location=@location, classification=@classification, instrument=@instrument, amount=@amount, placementDate=@placementDate, dueDate=@dueDate, observation=@observation WHERE id=@id`);
        } else {
            await pool.request()
                .input('id', sql.VarChar(50), a.id)
                .input('location', sql.VarChar(255), a.location)
                .input('classification', sql.VarChar(50), a.classification)
                .input('instrument', sql.VarChar(100), a.instrument || null)
                .input('amount', sql.Decimal(18, 2), a.amount)
                .input('placementDate', sql.Date, placementDate)
                .input('dueDate', sql.Date, dueDate)
                .input('observation', sql.VarChar(sql.MAX), a.observation || '')
                .query(`INSERT INTO Availables (id, location, classification, instrument, amount, placementDate, dueDate, observation) VALUES (@id, @location, @classification, @instrument, @amount, @placementDate, @dueDate, @observation)`);
        }
        res.json(a);
    } catch (err) {
        console.error('Error in POST /api/availables:', err);
        res.status(500).json({ error: err.message });
    }
});

// --- ENDPOINTS PARA USERS ---
app.get('/api/users', async (req, res) => {
    try {
        const pool = await getDbPool();
        const result = await pool.request().query('SELECT id, username, role, name, modules, Email FROM Users');
        const users = result.recordset.map(u => ({
            ...u,
            modules: u.modules ? JSON.parse(u.modules) : []
        }));
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- ENDPOINTS PARA NOTAS (PRIVADAS) ---

app.get('/api/notes/:userId', async (req, res) => {
    try {
        const pool = await getDbPool();
        const result = await pool.request()
            .input('userId', sql.VarChar, req.params.userId)
            .query('SELECT * FROM Notes WHERE userId = @userId ORDER BY pinned DESC, lastModified DESC');
        
        // Convertir BIT a Boolean para el frontend
        const notes = result.recordset.map(n => ({
            ...n,
            pinned: n.pinned === true || n.pinned === 1,
            archived: n.archived === true || n.archived === 1,
            deleted: n.deleted === true || n.deleted === 1
        }));
        res.json(notes);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/notes', async (req, res) => {
    try {
        const n = req.body;
        const pool = await getDbPool();
        
        // El contenido puede ser JSON string (para listas) o texto plano
        const content = typeof n.content === 'object' ? JSON.stringify(n.content) : n.content;
        const lastModified = n.lastModified || new Date().toISOString();

        console.log(`📝 Recibida nota ID: ${n.id} (Archivada: ${n.archived}, Eliminada: ${n.deleted})`);

        const check = await pool.request()
            .input('id', sql.VarChar(50), n.id)
            .query('SELECT id FROM Notes WHERE id = @id');

        if (check.recordset.length > 0) {
            await pool.request()
                .input('id', sql.VarChar(50), n.id)
                .input('userId', sql.VarChar(50), n.userId)
                .input('title', sql.VarChar(255), n.title || '')
                .input('content', sql.VarChar(sql.MAX), content)
                .input('type', sql.VarChar(50), n.type || 'text')
                .input('pinned', sql.Bit, n.pinned ? 1 : 0)
                .input('archived', sql.Bit, n.archived ? 1 : 0)
                .input('deleted', sql.Bit, n.deleted ? 1 : 0)
                .input('deletedAt', sql.DateTime, n.deletedAt ? new Date(n.deletedAt) : null)
                .input('lastModified', sql.DateTime, new Date(lastModified))
                .query(`UPDATE Notes SET userId=@userId, title=@title, content=@content, type=@type, pinned=@pinned, archived=@archived, deleted=@deleted, deletedAt=@deletedAt, lastModified=@lastModified WHERE id=@id`);
            console.log(`✅ Nota ${n.id} actualizada.`);
        } else {
            await pool.request()
                .input('id', sql.VarChar(50), n.id)
                .input('userId', sql.VarChar(50), n.userId)
                .input('title', sql.VarChar(255), n.title || '')
                .input('content', sql.VarChar(sql.MAX), content)
                .input('type', sql.VarChar(50), n.type || 'text')
                .input('pinned', sql.Bit, n.pinned ? 1 : 0)
                .input('archived', sql.Bit, n.archived ? 1 : 0)
                .input('deleted', sql.Bit, n.deleted ? 1 : 0)
                .input('deletedAt', sql.DateTime, n.deletedAt ? new Date(n.deletedAt) : null)
                .input('lastModified', sql.DateTime, new Date(lastModified))
                .query(`INSERT INTO Notes (id, userId, title, content, type, pinned, archived, deleted, deletedAt, lastModified) VALUES (@id, @userId, @title, @content, @type, @pinned, @archived, @deleted, @deletedAt, @lastModified)`);
            console.log(`✅ Nota ${n.id} creada.`);
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});



app.delete('/api/notes/:id', async (req, res) => {
    try {
        const pool = await getDbPool();
        const noteId = req.params.id;

        // Verificar si ya está marcada como eliminada
        const check = await pool.request()
            .input('id', sql.VarChar(50), noteId)
            .query('SELECT deleted FROM Notes WHERE id = @id');

        if (check.recordset.length > 0 && check.recordset[0].deleted) {
            // Si ya está en la papelera, eliminar para siempre
            await pool.request()
                .input('id', sql.VarChar(50), noteId)
                .query('DELETE FROM Notes WHERE id = @id');
            res.json({ success: true, permanent: true });
        } else {
            // Si no está eliminada, mover a la papelera
            await pool.request()
                .input('id', sql.VarChar(50), noteId)
                .input('deletedAt', sql.DateTime, new Date())
                .query('UPDATE Notes SET deleted = 1, pinned = 0, deletedAt = @deletedAt WHERE id = @id');
            res.json({ success: true, permanent: false });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Función para eliminar notas de la papelera con más de 30 días
async function deleteExpiredNotes() {
    try {
        const pool = await getDbPool();
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const result = await pool.request()
            .input('thirtyDaysAgo', sql.DateTime, thirtyDaysAgo)
            .query('DELETE FROM Notes WHERE deleted = 1 AND deletedAt < @thirtyDaysAgo');
        
        if (result.rowsAffected[0] > 0) {
            console.log(`🧹 Limpieza: ${result.rowsAffected[0]} notas antiguas eliminadas permanentemente.`);
        }
    } catch (err) {
        console.error('⚠️ Error en limpieza de notas:', err.message);
    }
}
app.delete('/api/users/:id', (req, res) => deleteApi(req, res, 'Users'));

// Guardar/actualizar un único usuario (con hash de contraseña)
app.post('/api/users', async (req, res) => {
    try {
        const u = req.body;
        const pool = await getDbPool();
        const check = await pool.request().input('id', sql.VarChar(50), u.id).query('SELECT id, password FROM Users WHERE id = @id');

        let hashedPassword;
        if (u.password && u.password.trim() !== '') {
            // Nueva contraseña o primera vez: hashear
            hashedPassword = await bcrypt.hash(u.password, BCRYPT_ROUNDS);
        } else if (check.recordset.length > 0) {
            // Edición sin cambio de contraseña: conservar el hash actual
            hashedPassword = check.recordset[0].password;
                } else {
            // SSO Migration: Auto-generate dummy password for new users since UI doesn't send it anymore
            hashedPassword = await bcrypt.hash('SSO_MANAGED_' + Date.now(), BCRYPT_ROUNDS);
        }

        const modulesJson = JSON.stringify(u.modules || []);

        if (check.recordset.length > 0) {
            await pool.request()
                .input('id', sql.VarChar(50), u.id)
                .input('username', sql.VarChar(50), u.username)
                .input('password', sql.VarChar(100), hashedPassword)
                .input('role', sql.VarChar(50), u.role)
                .input('name', sql.VarChar(100), u.name)
                .input('Email', sql.NVarChar(255), u.email || null)
                .input('modules', sql.VarChar(sql.MAX), modulesJson)
                .query(`UPDATE Users SET username=@username, password=@password, role=@role, name=@name, Email=@Email, modules=@modules WHERE id=@id`);
        } else {
            await pool.request()
                .input('id', sql.VarChar(50), u.id)
                .input('username', sql.VarChar(50), u.username)
                .input('password', sql.VarChar(100), hashedPassword)
                .input('role', sql.VarChar(50), u.role)
                .input('name', sql.VarChar(100), u.name)
                .input('Email', sql.NVarChar(255), u.email || null)
                .input('modules', sql.VarChar(sql.MAX), modulesJson)
                .query(`INSERT INTO Users (id, username, password, role, name, Email, modules) VALUES (@id, @username, @password, @role, @name, @Email, @modules)`);
        }
        // Retornar sin contraseña
        res.json({ id: u.id, username: u.username, role: u.role, name: u.name, email: u.email, modules: u.modules || [] });
    } catch (err) {
        console.error('Error in POST /api/users:', err);
        res.status(500).json({ error: err.message });
    }
});

// Batch (legacy / inicialización): hashear contraseñas si aún no lo están
app.post('/api/users/batch', async (req, res) => {
    try {
        const usersArray = req.body;
        const pool = await getDbPool();
        await pool.request().query('DELETE FROM Users');
        for (let u of usersArray) {
            // Si la contraseña ya es un hash bcrypt, no volver a hashear
            const alreadyHashed = u.password && u.password.startsWith('$2b$');
            const hashedPassword = alreadyHashed ? u.password : await bcrypt.hash(u.password, BCRYPT_ROUNDS);
            await pool.request()
                .input('id', sql.VarChar(50), u.id)
                .input('username', sql.VarChar(50), u.username)
                .input('password', sql.VarChar(100), hashedPassword)
                .input('role', sql.VarChar(50), u.role)
                .input('name', sql.VarChar(100), u.name)
                .input('modules', sql.VarChar(sql.MAX), JSON.stringify(u.modules || []))
                .query(`INSERT INTO Users (id, username, password, role, name, modules) VALUES (@id, @username, @password, @role, @name, @modules)`);
        }
        res.json(usersArray);
    } catch (err) {
        console.error('Error in POST /api/users/batch:', err);
        res.status(500).json({ error: err.message });
    }
});

// --- ENDPOINT DE AUTENTICACIÓN ---
    // --- MSAL SSO CONF ---
    const msalConfigAuth = {
        auth: {
            clientId: process.env.AZURE_CLIENT_ID,
            authority: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}`,
            clientSecret: process.env.AZURE_CLIENT_SECRET,
        }
    };
    const pca = new msal.ConfidentialClientApplication(msalConfigAuth);

    // API: Iniciar Login con SSO
    app.get('/api/auth/signin', (req, res) => {
        const authCodeUrlParameters = {
            scopes: ["user.read"],
            redirectUri: "https://admin.simons.cl/api/auth/redirect",
        };
        pca.getAuthCodeUrl(authCodeUrlParameters).then((response) => {
            res.redirect(response);
        }).catch((error) => console.log(JSON.stringify(error)));
    });

    // API: Callback de Microsoft
    app.get('/api/auth/redirect', (req, res) => {
        const tokenRequest = {
            code: req.query.code,
            scopes: ["user.read"],
            redirectUri: "https://admin.simons.cl/api/auth/redirect",
        };
        pca.acquireTokenByCode(tokenRequest).then(async (response) => {
            const email = response.account.username.toLowerCase();
            try {
                const pool = await getDbPool();
                const result = await pool.request()
                    .input('Email', sql.NVarChar(255), email)
                    .query('SELECT id, username, role, name, modules FROM Users WHERE Email = @Email');

                if (result.recordset.length === 0) {
                    return res.send("<h3>Acceso Denegado</h3><p>Tu usuario corporativo (" + email + ") no está autorizado en Contabilidad. Habla con el administrador.</p>");
                }

                const user = result.recordset[0];
                const sessionModules = user.modules ? JSON.parse(user.modules) : [];
                
                const jwtToken = jwt.sign({ 
                    id: user.id, 
                    email: email, 
                    role: user.role, 
                    modules: sessionModules 
                }, JWT_SECRET, { expiresIn: '12h' });

                const sessionData = {
                    id: user.id,
                    username: user.username,
                    email: email,
                    role: user.role,
                    name: user.name,
                    modules: sessionModules,
                    lastActivity: Date.now(),
                    token: jwtToken
                };

                // Retornar script al navegador para guardar la sesión (que usa localStorage igual que el sistema actual)
                res.send(`<script>
                    localStorage.setItem('contabilidad_session', JSON.stringify(${JSON.stringify(sessionData)}));
                    window.location.href = '/';
                </script>`);
            } catch (err) {
                console.error('Error en SSO auth:', err.message);
                res.status(500).send("Error interno validando usuario.");
            }
        }).catch((error) => {
            console.log(error);
            res.status(500).send(error);
        });
    });



// --- ENDPOINTS PARA CRM (Prospectos y Bitácora) ---

app.get('/api/crm/prospectos', (req, res) => getApi(req, res, 'CRM_Prospectos'));
app.delete('/api/crm/prospectos/:id', (req, res) => deleteApi(req, res, 'CRM_Prospectos'));

app.post('/api/crm/prospectos', async (req, res) => {
    try {
        const p = req.body;
        const pool = await getDbPool();
        const check = await pool.request().input('id', sql.VarChar(50), p.id).query('SELECT id FROM CRM_Prospectos WHERE id = @id');

        if (check.recordset.length > 0) {
            await pool.request()
                .input('id', sql.VarChar(50), p.id)
                .input('nombre_empresa', sql.VarChar(255), p.nombre_empresa)
                .input('contacto_principal', sql.VarChar(255), p.contacto_principal || '')
                .input('telefono', sql.VarChar(50), p.telefono || '')
                .input('email', sql.VarChar(255), p.email || '')
                .input('servicio_interes', sql.VarChar(50), p.servicio_interes)
                .input('estado', sql.VarChar(50), p.estado || 'Frío')
                .query(`UPDATE CRM_Prospectos SET nombre_empresa=@nombre_empresa, contacto_principal=@contacto_principal, 
                        telefono=@telefono, email=@email, servicio_interes=@servicio_interes, estado=@estado WHERE id=@id`);
        } else {
            await pool.request()
                .input('id', sql.VarChar(50), p.id)
                .input('nombre_empresa', sql.VarChar(255), p.nombre_empresa)
                .input('contacto_principal', sql.VarChar(255), p.contacto_principal || '')
                .input('telefono', sql.VarChar(50), p.telefono || '')
                .input('email', sql.VarChar(255), p.email || '')
                .input('servicio_interes', sql.VarChar(50), p.servicio_interes)
                .input('estado', sql.VarChar(50), p.estado || 'Frío')
                .query(`INSERT INTO CRM_Prospectos (id, nombre_empresa, contacto_principal, telefono, email, servicio_interes, estado) 
                        VALUES (@id, @nombre_empresa, @contacto_principal, @telefono, @email, @servicio_interes, @estado)`);
        }
        res.json(p);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/crm/calls/:prospectoId', async (req, res) => {
    try {
        const pool = await getDbPool();
        const result = await pool.request()
            .input('pid', sql.VarChar(50), req.params.prospectoId)
            .query('SELECT * FROM CRM_Historial_Llamadas WHERE prospecto_id = @pid ORDER BY fecha DESC');
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/crm/calls', async (req, res) => {
    try {
        const c = req.body;
        const pool = await getDbPool();
        await pool.request()
            .input('id', sql.VarChar(50), c.id)
            .input('pid', sql.VarChar(50), c.prospecto_id)
            .input('comentario', sql.VarChar(sql.MAX), c.comentario)
            .input('resultado', sql.VarChar(100), c.resultado)
            .query(`INSERT INTO CRM_Historial_Llamadas (id, prospecto_id, comentario, resultado) 
                    VALUES (@id, @pid, @comentario, @resultado)`);
        res.json(c);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// CONFIGURACIÓN MICROSOFT GRAPH API (CRM)
let GRAPH_CONFIG = {
    tenantId: '',
    clientId: '',
    clientSecret: '',
    senderEmail: ''
};

// Intentar cargar configuración desde archivo externo por seguridad
try {
    const configPath = path.join(__dirname, 'config_crm.json');
    if (fs.existsSync(configPath)) {
        GRAPH_CONFIG = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        console.log("✅ Configuración CRM cargada desde config_crm.json");
    } else {
        console.warn("⚠️ Advertencia: No se encontró config_crm.json. El envío de correos CRM podría fallar.");
    }
} catch (err) {
    console.error("❌ Error cargando configuración CRM:", err.message);
}

// Función para obtener Access Token de Microsoft Graph
async function getGraphAccessToken() {
    const url = `https://login.microsoftonline.com/${GRAPH_CONFIG.tenantId}/oauth2/v2.0/token`;
    const params = new URLSearchParams();
    params.append('client_id', GRAPH_CONFIG.clientId);
    params.append('scope', 'https://graph.microsoft.com/.default');
    params.append('client_secret', GRAPH_CONFIG.clientSecret);
    params.append('grant_type', 'client_credentials');

    try {
        const response = await axios.post(url, params.toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        return response.data.access_token;
    } catch (error) {
        console.error('❌ Error obteniendo token de Graph:', error.response ? error.response.data : error.message);
        throw new Error('No se pudo autenticar con Microsoft Graph');
    }
}

app.post('/api/crm/send-emails', async (req, res) => {
    const { recipients, subject, body } = req.body;
    
    console.log("--- [CRM GRAPH DEBUG] Iniciando Proceso ---");
    console.log("Destinatarios:", recipients ? recipients.length : '0');
    console.log("Asunto:", subject);

    if (!recipients || !recipients.length || !subject || !body) {
        return res.status(400).json({ error: 'Faltan datos obligatorios (destinatarios, asunto o cuerpo)' });
    }

    try {
        const accessToken = await getGraphAccessToken();
        console.log("✅ Token de Graph obtenido con éxito");

        const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
        let results = [];
        let sentCount = 0;

        // --- PROCESAMIENTO DE IMÁGENES: ADJUNTOS INLINE CON CID ---
        // Exchange/Outlook bloquea data URIs en el body HTML.
        // La solución estándar es adjuntar la imagen con un contentId (CID)
        // y referenciarla en el HTML como src="cid:contentId".
        let processedBody = body;
        const imgRegex = /<img[^>]+src="([^">]+)"/g;
        let match;
        const processedImages = new Map(); // src -> contentId
        const inlineAttachments = [];
        let cidCounter = 0;

        console.log("🔍 Escaneando imágenes para adjuntos CID...");
        imgRegex.lastIndex = 0;

        while ((match = imgRegex.exec(body)) !== null) {
            const src = match[1];
            if (src.includes('/uploads/') && !processedImages.has(src)) {
                try {
                    const filename = src.split('/').pop();
                    const filePath = path.join(__dirname, 'uploads', filename);

                    if (fs.existsSync(filePath)) {
                        const fileContent = fs.readFileSync(filePath, { encoding: 'base64' });
                        const extension = filename.split('.').pop().toLowerCase();
                        const mimeType = `image/${extension === 'jpg' ? 'jpeg' : extension}`;
                        const contentId = `img${cidCounter++}@crm`;

                        // Reemplazar URL por referencia CID en el HTML
                        processedBody = processedBody.split(src).join(`cid:${contentId}`);
                        processedImages.set(src, contentId);

                        inlineAttachments.push({
                            '@odata.type': '#microsoft.graph.fileAttachment',
                            name: filename,
                            contentType: mimeType,
                            contentBytes: fileContent,
                            contentId: contentId,
                            isInline: true
                        });
                        console.log(`✨ Imagen preparada CID: ${filename} → cid:${contentId}`);
                    } else {
                        console.warn(`⚠️ Archivo no encontrado: ${filePath}`);
                    }
                } catch (e) {
                    console.error("❌ Error preparando imagen CID:", e.message);
                }
            }
        }

        for (const email of recipients) {
            try {
                const messageBody = {
                    subject: subject,
                    body: { contentType: 'HTML', content: processedBody },
                    toRecipients: [{ emailAddress: { address: email } }]
                };
                if (inlineAttachments.length > 0) {
                    messageBody.attachments = inlineAttachments;
                }
                const message = { message: messageBody };

                await axios.post(
                    `https://graph.microsoft.com/v1.0/users/${GRAPH_CONFIG.senderEmail}/sendMail`,
                    message,
                    {
                        headers: {
                            'Authorization': `Bearer ${accessToken}`,
                            'Content-Type': 'application/json'
                        }
                    }
                );

                sentCount++;
                results.push({ email, success: true });
                console.log(`✅ [Graph] Email enviado a: ${email} (${sentCount}/${recipients.length})`);
                
                if (sentCount < recipients.length) {
                    await delay(1500); 
                }
            } catch (err) {
                const errorDetail = err.response ? JSON.stringify(err.response.data) : err.message;
                console.error(`❌ [Graph] Error enviando a ${email}:`, errorDetail);
                results.push({ email, success: false, error: errorDetail });
            }
        }

        res.json({ success: true, sent: sentCount, results });
    } catch (err) {
        console.error('❌ Error general en envío Graph:', err.message);
        res.status(500).json({ error: 'Error en Microsoft Graph: ' + err.message });
    }
});

app.post('/api/crm/upload-image', upload.single('image'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No se subió ninguna imagen' });
    
    // Devolver la URL relativa (ya que express.static sirve __dirname)
    const imageUrl = `/uploads/${req.file.filename}`;
    res.json({ url: imageUrl });
});

// --- ENDPOINTS PARA CONTRACTS ---
app.get('/api/contracts', (req, res) => getApi(req, res, 'Contracts'));
app.delete('/api/contracts/:id', async (req, res) => {
    try {
        const pool = await getDbPool();
        
        // Obtener la ruta del documento para borrarlo físicamente
        const contractRes = await pool.request()
            .input('id', sql.VarChar(50), req.params.id)
            .query('SELECT documentPath FROM Contracts WHERE id = @id');
        
        const documentPath = contractRes.recordset[0]?.documentPath;
        
        // Borrar primero el historial para no violar la llave foránea
        await pool.request()
            .input('id', sql.VarChar, req.params.id)
            .query('DELETE FROM ContractHistory WHERE contractId = @id');

        await pool.request()
            .input('id', sql.VarChar, req.params.id)
            .query('DELETE FROM Contracts WHERE id = @id');

        // Eliminar el archivo de OneDrive de forma asíncrona (si existe)
        if (documentPath) {
            deleteRemoteFile(documentPath).catch(err => console.error('Error borrando doc contrato:', err));
        }

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Documentos de Contratos ---
app.post('/api/contracts/:id/upload-document', uploadDocument.single('document'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No se subió ningún archivo' });
        
        const pool = await getDbPool();
        const contractId = req.params.id;
        
        // Obtener el cliente para saber el nombre de la carpeta
        const contractRes = await pool.request()
            .input('id', sql.VarChar(50), contractId)
            .query(`
                SELECT c.clientId, cl.name as clientName 
                FROM Contracts c 
                JOIN Clients cl ON c.clientId = cl.id 
                WHERE c.id = @id
            `);
            
        if (contractRes.recordset.length === 0) {
            return res.status(404).json({ error: 'Contrato no encontrado' });
        }
        
        const clientName = contractRes.recordset[0].clientName || 'SinCliente';
        
        const fileName = req.file.originalname;
        
        // Añadir timestamp para histórico (no sobreescribir)
        const safeFileName = `${Date.now()}_${fileName}`;
        const uploadedFilePath = req.file.path; // Archivo temporal que creó multer
        const localFilePath = path.join(path.dirname(uploadedFilePath), safeFileName);
        
        // Renombramos el archivo temporal para que tenga el nombre correcto
        fs.renameSync(uploadedFilePath, localFilePath);
        
        const remoteDestDir = `onedrive_backup:Simons SPA/Clientes/Contratos APP/${clientName}`;
        const finalRemotePath = `${remoteDestDir}/${safeFileName}`;
        
        const rcloneArgs = ['copy', localFilePath, remoteDestDir];
        const rcloneConfigPath = '/home/administrador/.config/rclone/rclone.conf';
        if (fs.existsSync(rcloneConfigPath)) {
            rcloneArgs.push('--config', rcloneConfigPath);
        }
        
        const { execFile } = require('child_process');
        execFile('/usr/bin/rclone', rcloneArgs, async (error, stdout, stderr) => {
            try {
                if (fs.existsSync(localFilePath)) fs.unlinkSync(localFilePath);
            } catch (unlinkErr) {}

            if (error) {
                console.error('Error al subir documento de contrato:', error);
                return res.status(500).json({ error: 'Error de subida de documento.' });
            }
            
            // Actualizar DB
            await pool.request()
                .input('id', sql.VarChar(50), contractId)
                .input('path', sql.VarChar(sql.MAX), finalRemotePath)
                .query('UPDATE Contracts SET documentPath = @path WHERE id = @id');
                
            res.json({ success: true, documentPath: finalRemotePath });
        });
    } catch (err) {
        console.error('Error en upload contrato:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/contracts/:id/download-document', async (req, res) => {
    try {
        const pool = await getDbPool();
        const result = await pool.request()
            .input('id', sql.VarChar(50), req.params.id)
            .query('SELECT documentPath FROM Contracts WHERE id = @id');
            
        if (result.recordset.length === 0 || !result.recordset[0].documentPath) {
            return res.status(404).send('Documento no encontrado.');
        }
        
        const documentPath = result.recordset[0].documentPath;
        const fileName = path.basename(documentPath);
        
        const { spawn } = require('child_process');
        const rcloneArgs = ['cat', documentPath];
        const rcloneConfigPath = '/home/administrador/.config/rclone/rclone.conf';
        if (fs.existsSync(rcloneConfigPath)) {
            rcloneArgs.push('--config', rcloneConfigPath);
        }

        res.setHeader('Content-Disposition', `attachment; filename="${fileName.replace(/^\d+_/, '')}"`);
        const ext = fileName.split('.').pop().toLowerCase();
        if (ext === 'pdf') res.setHeader('Content-Type', 'application/pdf');
        
        const child = spawn('/usr/bin/rclone', rcloneArgs);
        child.stdout.pipe(res);
        child.on('error', (err) => {
            console.error('rclone spawn error:', err);
            if (!res.headersSent) res.status(500).send(`Error de descarga: ${err.message}`);
        });
    } catch (err) {
        res.status(500).send('Error interno del servidor.');
    }
});

app.delete('/api/contracts/:id/document', async (req, res) => {
    try {
        const pool = await getDbPool();
        const result = await pool.request()
            .input('id', sql.VarChar(50), req.params.id)
            .query('SELECT documentPath FROM Contracts WHERE id = @id');
            
        if (result.recordset.length > 0 && result.recordset[0].documentPath) {
            const documentPath = result.recordset[0].documentPath;
            // Borrar de rclone
            deleteRemoteFile(documentPath).catch(err => console.error('Error borrando:', err));
            // Borrar de DB
            await pool.request()
                .input('id', sql.VarChar(50), req.params.id)
                .query('UPDATE Contracts SET documentPath = NULL WHERE id = @id');
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.post('/api/contracts', async (req, res) => {
    try {
        const c = req.body;
        const pool = await getDbPool();
        await pool.request()
            .input('id', sql.VarChar, c.id)
            .input('clientId', sql.VarChar, c.clientId)
            .input('amount', sql.Decimal(18, 2), c.amount)
            .input('startDate', sql.Date, c.startDate)
            .input('endDate', sql.Date, c.endDate)
            .input('billingDay', sql.Int, c.billingDay)
            .input('frequency', sql.VarChar, c.frequency || 'mensual')
            .input('currency', sql.VarChar, c.currency || 'CLP')
            .query(`
                IF EXISTS (SELECT 1 FROM Contracts WHERE id = @id)
                UPDATE Contracts SET 
                    clientId = @clientId, amount = @amount, startDate = @startDate, 
                    endDate = @endDate, billingDay = @billingDay, frequency = @frequency,
                    currency = @currency
                WHERE id = @id
                ELSE
                INSERT INTO Contracts (id, clientId, amount, startDate, endDate, billingDay, frequency, currency)
                VALUES (@id, @clientId, @amount, @startDate, @endDate, @billingDay, @frequency, @currency)
            `);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/uf', async (req, res) => {
    const uf = await fetchUF();
    if (uf) res.json({ valor: uf });
    else res.status(500).json({ error: "No se pudo obtener el valor de la UF" });
});

app.get('/api/exchange-rates', async (req, res) => {
    const uf = await fetchUF();
    const dolar = await fetchDolar();
    res.json({ 
        uf: uf || 37700, 
        dolar: dolar || 950,
        ufApiFailed: ratesCache.uf.apiFailed,
        dolarApiFailed: ratesCache.dolar.apiFailed
    });
});

app.get('/api/contracts/pending', async (req, res) => {
    try {
        const pool = await getDbPool();
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = String(now.getMonth() + 1).padStart(2, '0');
        const currentDay = now.getDate();
        const currentPeriod = `${currentYear}-${currentMonth}`;
        const currentDateStr = `${currentYear}-${currentMonth}-${String(currentDay).padStart(2, '0')}`;

        const query = `
            SELECT * FROM Contracts 
            WHERE startDate <= @currentDate 
              AND (endDate IS NULL OR endDate >= @currentDate)
              AND billingDay <= @currentDay
              AND (lastInvoicedPeriod IS NULL OR lastInvoicedPeriod != @currentPeriod)
        `;
        const result = await pool.request()
            .input('currentDate', sql.Date, currentDateStr)
            .input('currentDay', sql.Int, currentDay)
            .input('currentPeriod', sql.VarChar, currentPeriod)
            .query(query);

        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/contracts/:id/invoice', async (req, res) => {
    try {
        const pool = await getDbPool();
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = String(now.getMonth() + 1).padStart(2, '0');
        const currentPeriod = `${currentYear}-${currentMonth}`;

        const contractId = req.params.id;

        const contractRes = await pool.request()
            .input('id', sql.VarChar(50), contractId)
            .query(`SELECT c.*, cl.name as clientName, cl.nombreFantasia as clientFantasyName
                    FROM Contracts c
                    LEFT JOIN Clients cl ON c.clientId = cl.id
                    WHERE c.id = @id`);

        if (contractRes.recordset.length === 0) {
            return res.status(404).json({ error: "Contrato no encontrado" });
        }

        const contract = contractRes.recordset[0];
        const debtorName = contract.clientName || 'Cliente Desconocido';
        let amount = contract.amount;
        let ufValueUsed = null;

        if (contract.currency === 'UF') {
            ufValueUsed = await fetchUF();
            if (!ufValueUsed) {
                return res.status(500).json({ error: "No se pudo obtener el valor de la UF. Verifique conexión." });
            }
            amount = Math.round(amount * ufValueUsed);
        }

        const amountFinal = Math.round(amount * 1.19); // Aplicar 19% IVA

        await pool.request()
            .input('id', sql.VarChar(50), contractId)
            .input('period', sql.VarChar(50), currentPeriod)
            .query(`UPDATE Contracts SET lastInvoicedPeriod = @period WHERE id = @id`);

        // Integración Módulo Deudores (Vencimiento INMEDIATO: hoy)
        const dueDate = new Date();
        const newDebtorId = 'D' + Date.now().toString() + Math.floor(Math.random() * 1000);

        // Determinar nombre del periodo (YYYY-MM para consistencia)
        const periodNameStr = currentPeriod;
        const descriptionStr = `Mensualidad Contrato ${currentPeriod} (INC. IVA)`;

        await pool.request()
            .input('id', sql.VarChar(50), newDebtorId)
            .input('debtor', sql.VarChar(255), debtorName)
            .input('amount', sql.Decimal(18, 2), amountFinal)
            .input('dueDate', sql.Date, dueDate)
            .input('description', sql.VarChar(sql.MAX), descriptionStr)
            .input('status', sql.VarChar(50), 'pending')
            .query(`INSERT INTO Debtors (id, debtor, amount, dueDate, description, status) VALUES (@id, @debtor, @amount, @dueDate, @description, @status)`);

        // Registrar en Historial de Contratos (ContractHistory)
        const historyId = 'CH' + Date.now().toString() + Math.floor(Math.random() * 1000);

        await pool.request()
            .input('id', sql.VarChar(50), historyId)
            .input('contractId', sql.VarChar(50), contractId)
            .input('clientId', sql.VarChar(50), contract.clientId || '')
            .input('periodName', sql.VarChar(100), periodNameStr)
            .input('issueDate', sql.Date, dueDate)
            .input('amount', sql.Decimal(18, 2), contract.amount)
            .input('amountCLP', sql.Decimal(18, 2), amount)
            .input('ufValue', sql.Decimal(18, 4), ufValueUsed)
            .input('debtorId', sql.VarChar(50), newDebtorId)
            .query(`INSERT INTO ContractHistory (id, contractId, clientId, periodName, issueDate, amount, amountCLP, ufValue, debtorId) VALUES (@id, @contractId, @clientId, @periodName, @issueDate, @amount, @amountCLP, @ufValue, @debtorId)`);

        res.json({ success: true, period: currentPeriod });
    } catch (err) {
        console.error('Error in POST /api/contracts/:id/invoice:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/contracts/invoiced-history', async (req, res) => {
    try {
        const pool = await getDbPool();
        const query = `
            SELECT ch.*, cl.nombreFantasia as clientFantasyName, cl.name as clientName
            FROM ContractHistory ch
            LEFT JOIN Clients cl ON ch.clientId = cl.id
            ORDER BY ch.issueDate DESC
        `;
        const result = await pool.request().query(query);
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});




app.post('/api/contracts/:id/undo', async (req, res) => {
    try {
        const pool = await getDbPool();
        const contractId = req.params.id;

        // 1. Obtener el historial más reciente de este contrato para saber qué deudor borrar
        const historyRes = await pool.request()
            .input('contractId', sql.VarChar, contractId)
            .query(`SELECT TOP 1 id, debtorId, periodName FROM ContractHistory WHERE contractId = @contractId ORDER BY issueDate DESC`);

        if (historyRes.recordset.length > 0) {
            const history = historyRes.recordset[0];

            // 2. Eliminar el registro del historial
            await pool.request()
                .input('id', sql.VarChar, history.id)
                .query(`DELETE FROM ContractHistory WHERE id = @id`);

            // 3. Eliminar la deuda generada automáticamente en Debtors
            if (history.debtorId) {
                await pool.request()
                    .input('debtorId', sql.VarChar, history.debtorId)
                    .query(`DELETE FROM Debtors WHERE id = @debtorId`);
            }
        }

        // 4. Limpiar lastInvoicedPeriod del contrato (para que vuelva a salir en "Pendientes de Mes")
        await pool.request()
            .input('id', sql.VarChar, contractId)
            .query(`UPDATE Contracts SET lastInvoicedPeriod = '' WHERE id = @id`);

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Endpoint para obtener el historial de contratos de un cliente
app.get('/api/contracts/history/:clientId', async (req, res) => {
    try {
        const pool = await getDbPool();
        const result = await pool.request()
            .input('clientId', sql.VarChar, req.params.clientId)
            .query(`
                SELECT ch.*, d.status as debtStatus 
                FROM ContractHistory ch
                LEFT JOIN Debtors d ON ch.debtorId = d.id
                WHERE ch.clientId = @clientId
                ORDER BY ch.issueDate DESC
            `);
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- ENDPOINTS PARA PROJECTS ---

app.delete('/api/projects/:id', async (req, res) => {
    try {
        const pool = await getDbPool();
        // En lugar de borrar físicamente (lo cual causaba que el cron job lo reviviera si venía de una cotización), 
        // hacemos un Soft-Delete
        const prevRes = await pool.request()
            .input('id', sql.VarChar(50), req.params.id)
            .query('SELECT status FROM Projects WHERE id = @id');
        const prevStatus = prevRes.recordset.length > 0 ? prevRes.recordset[0].status : null;

        await pool.request()
            .input('id', sql.VarChar(50), req.params.id)
            .query("UPDATE Projects SET status = 'Eliminado' WHERE id = @id");

        await pool.request()
            .input('projectId', sql.VarChar(50), req.params.id)
            .input('prevStatus', sql.NVarChar(50), prevStatus)
            .query("INSERT INTO ProjectHistory (projectId, previousStatus, newStatus, changeDate, note) VALUES (@projectId, @prevStatus, 'Eliminado', GETDATE(), 'Proyecto eliminado (Soft Delete)')");
        
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/projects', async (req, res) => {
    try {
        const p = req.body;
        const pool = await getDbPool();
        const check = await pool.request().input('id', sql.VarChar(50), p.id).query('SELECT id FROM Projects WHERE id = @id');

        if (check.recordset.length > 0) {
            await pool.request()
                .input('id', sql.VarChar(50), p.id)
                .input('clientId', sql.VarChar(50), p.clientId)
                .input('projectName', sql.VarChar(255), p.projectName || null)
                .input('status', sql.VarChar(50), p.status)
                .input('observations', sql.VarChar(sql.MAX), p.observations || '')
                .input('visitDate', sql.Date, p.visitDate || null)
                .input('executionDate', sql.Date, p.executionDate || null)
                .input('estimatedAmount', sql.Decimal(18, 2), p.estimatedAmount || null)
                .input('finalAmount', sql.Decimal(18, 2), p.finalAmount || null)
                .query(`UPDATE Projects SET projectName=@projectName, clientId=@clientId, status=@status, observations=@observations, visitDate=@visitDate, executionDate=@executionDate, estimatedAmount=@estimatedAmount, finalAmount=@finalAmount WHERE id=@id`);
        } else {
            await pool.request()
                .input('id', sql.VarChar(50), p.id)
                .input('projectName', sql.VarChar(255), p.projectName || null)
                .input('clientId', sql.VarChar(50), p.clientId)
                .input('status', sql.VarChar(50), p.status || 'Evaluación')
                .input('observations', sql.VarChar(sql.MAX), p.observations || '')
                .input('visitDate', sql.Date, p.visitDate || null)
                .input('executionDate', sql.Date, p.executionDate || null)
                .input('estimatedAmount', sql.Decimal(18, 2), p.estimatedAmount || null)
                .input('finalAmount', sql.Decimal(18, 2), p.finalAmount || null)
                .query(`INSERT INTO Projects (id, projectName, clientId, status, observations, visitDate, executionDate, estimatedAmount, finalAmount) VALUES (@id, @projectName, @clientId, @status, @observations, @visitDate, @executionDate, @estimatedAmount, @finalAmount)`);
        }
        res.json(p);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/projects/:id/history', async (req, res) => {
    try {
        const pool = await getDbPool();
        const result = await pool.request()
            .input('projectId', sql.VarChar(50), req.params.id)
            .query('SELECT * FROM ProjectHistory WHERE projectId = @projectId ORDER BY changeDate DESC');
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/projects/:id/history', async (req, res) => {
    try {
        const h = req.body;
        const pool = await getDbPool();
        const req2 = pool.request()
            .input('projectId', sql.VarChar(50), req.params.id)
            .input('previousStatus', sql.VarChar(50), h.previousStatus || null)
            .input('newStatus', sql.VarChar(50), h.newStatus)
            .input('note', sql.VarChar(sql.MAX), h.note || '');

        if (h.changeDate) {
            req2.input('changeDate', sql.Date, h.changeDate);
            await req2.query(`INSERT INTO ProjectHistory (projectId, previousStatus, newStatus, note, changeDate) VALUES (@projectId, @previousStatus, @newStatus, @note, @changeDate)`);
        } else {
            await req2.query(`INSERT INTO ProjectHistory (projectId, previousStatus, newStatus, note) VALUES (@projectId, @previousStatus, @newStatus, @note)`);
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/projects/history/:id', async (req, res) => {
    try {
        const pool = await getDbPool();
        await pool.request()
            .input('id', sql.Int, req.params.id)
            .query('DELETE FROM ProjectHistory WHERE id = @id');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/projects/history/:id', async (req, res) => {
    try {
        const h = req.body;
        const pool = await getDbPool();
        await pool.request()
            .input('id', sql.Int, req.params.id)
            .input('note', sql.VarChar(sql.MAX), h.note || '')
            .input('newStatus', sql.VarChar(50), h.newStatus)
            .input('changeDate', sql.Date, h.changeDate || null)
            .query('UPDATE ProjectHistory SET note = @note, newStatus = @newStatus, changeDate = @changeDate WHERE id = @id');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- ENDPOINTS PARA DISPONIBLE ---
app.get('/api/availables', async (req, res) => {
    try {
        const pool = await getDbPool();
        const result = await pool.request().query('SELECT * FROM AvailableFunds');
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/availables', async (req, res) => {
    try {
        const a = req.body;
        const pool = await getDbPool();
        const request = pool.request()
            .input('id', sql.VarChar(50), a.id)
            .input('location', sql.VarChar(255), a.location)
            .input('classification', sql.VarChar(50), a.classification)
            .input('instrument', sql.VarChar(100), a.instrument || null)
            .input('amount', sql.Decimal(18, 2), a.amount)
            .input('placementDate', sql.Date, a.placementDate || null)
            .input('dueDate', sql.Date, a.dueDate || null)
            .input('observation', sql.VarChar(sql.MAX), a.observation || '');

        await request.query(`
            IF EXISTS (SELECT 1 FROM AvailableFunds WHERE id = @id)
                UPDATE AvailableFunds SET 
                    location = @location, 
                    classification = @classification, 
                    instrument = @instrument, 
                    amount = @amount, 
                    placementDate = @placementDate, 
                    dueDate = @dueDate, 
                    observation = @observation 
                WHERE id = @id
            ELSE
                INSERT INTO AvailableFunds (id, location, classification, instrument, amount, placementDate, dueDate, observation) 
                VALUES (@id, @location, @classification, @instrument, @amount, @placementDate, @dueDate, @observation)
        `);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/availables/:id', async (req, res) => {
    try {
        const pool = await getDbPool();
        await pool.request()
            .input('id', sql.VarChar(50), req.params.id)
            .query('DELETE FROM AvailableFunds WHERE id = @id');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- ENDPOINTS PARA COTIZACIONES ---

// Limpiar cotizaciones antiguas (> 90 días)
async function cleanOldQuotations() {
    try {
        const pool = await getDbPool();
        const result = await pool.request().query('DELETE FROM Quotations WHERE createdAt < DATEADD(day, -90, GETDATE())');
        if (result.rowsAffected[0] > 0) {
            console.log(`🧹 Limpieza: Se eliminaron ${result.rowsAffected[0]} cotizaciones antiguas de la BD.`);
        }
    } catch (err) {
        console.error('Error en limpieza de cotizaciones:', err);
    }
}

// Sincronizar cotizaciones existentes a la tabla de proyectos si no existen
async function syncQuotationsToProjects() {
    console.log('--- Iniciando Sincronización de Cotizaciones a Proyectos ---');
    try {
        const pool = await getDbPool();
        const quotationsRes = await pool.request().query('SELECT * FROM Quotations');
        const quotations = quotationsRes.recordset;

        for (const q of quotations) {
            const projectId = 'PROJ-' + q.id;
            const versionSuffix = (q.version && q.version > 1) ? ' v' + q.version : '';
            const finalProjectName = (q.projectName || 'Proyecto sin nombre') + versionSuffix;
            const projectStatus = 'Cotizado';

            // Verificar si el proyecto ya existe
            const projectCheck = await pool.request()
                .input('id', sql.VarChar(50), projectId)
                .query('SELECT id, status FROM Projects WHERE id = @id');

            // Convertir el monto estimado a Pesos Chilenos (CLP) para guardarlo en la tabla de proyectos
            let estimatedAmountClp = q.total;
            let conversionNote = '';
            if (q.currency === 'USD') {
                const rateUSD = await fetchDolar();
                if (rateUSD) {
                    estimatedAmountClp = q.total * rateUSD;
                    conversionNote = ` (${q.total} USD a tasa de $${rateUSD} CLP)`;
                }
            } else if (q.currency === 'UF') {
                const rateUF = await fetchUF();
                if (rateUF) {
                    estimatedAmountClp = q.total * rateUF;
                    conversionNote = ` (${q.total} UF a tasa de $${rateUF} CLP)`;
                }
            }
            estimatedAmountClp = Math.round(estimatedAmountClp);

            if (projectCheck.recordset.length === 0) {
                console.log(`Creando proyecto faltante ${projectId} para Cotización N° ${q.id}`);
                // Si no existe, crear el proyecto automáticamente en estado 'Cotizado'
                await pool.request()
                    .input('id', sql.VarChar(50), projectId)
                    .input('projectName', sql.VarChar(255), finalProjectName)
                    .input('clientId', sql.VarChar(50), q.clientId)
                    .input('status', sql.VarChar(50), projectStatus)
                    .input('observations', sql.VarChar(sql.MAX), 'Creado automáticamente por sincronización de Cotización N° ' + q.id + conversionNote)
                    .input('estimatedAmount', sql.Decimal(18, 2), estimatedAmountClp)
                    .query(`
                        INSERT INTO Projects (id, projectName, clientId, status, observations, estimatedAmount, visitDate) 
                        VALUES (@id, @projectName, @clientId, @status, @observations, @estimatedAmount, GETDATE())
                    `);

                // Registrar en la bitácora de historial del proyecto
                await pool.request()
                    .input('projectId', sql.VarChar(50), projectId)
                    .input('newStatus', sql.VarChar(50), projectStatus)
                    .input('note', sql.VarChar(sql.MAX), 'Creado automáticamente por sincronización de Cotización N° ' + q.id + versionSuffix + conversionNote)
                    .query(`
                        INSERT INTO ProjectHistory (projectId, previousStatus, newStatus, note, changeDate) 
                        VALUES (@projectId, NULL, @newStatus, @note, GETDATE())
                    `);
            }
        }
        console.log('✅ Sincronización de Cotizaciones a Proyectos completada.');
    } catch (err) {
        console.error('❌ Error en sincronización de Cotizaciones a Proyectos:', err.message);
    }
}


app.get('/api/quotations', async (req, res) => {
    try {
        await cleanOldQuotations();
        const pool = await getDbPool();
        const result = await pool.request().query('SELECT * FROM Quotations ORDER BY createdAt DESC');
        console.log(`📦 Historial: Sirviendo ${result.recordset.length} cotizaciones.`);
        res.json(result.recordset);
    } catch (err) {
        console.error('Error al obtener cotizaciones:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/quotations/next-id/:prefixOrId/:year', async (req, res) => {
    try {
        const year = parseInt(req.params.year);
        let prefix = req.params.prefixOrId;
        
        // Si el 'prefix' es un UUID o muy largo, es probable que sea el clientId (código viejo)
        if (prefix.length > 5) {
            const pool = await getDbPool();
            const clientRes = await pool.request()
                .input('id', sql.VarChar(50), prefix)
                .query('SELECT name, nombreFantasia FROM Clients WHERE id = @id');
            
            if (clientRes.recordset.length > 0) {
                const c = clientRes.recordset[0];
                const nameStr = c.nombreFantasia || c.name || 'XXX';
                prefix = nameStr.replace(/[^A-Za-z]/g, '').substring(0, 3).toUpperCase().padEnd(3, 'X');
            } else {
                prefix = prefix.substring(0, 3).toUpperCase();
            }
        }

        const pool = await getDbPool();
        // Búsqueda estricta que incluya el prefijo y el año para evitar falsos positivos
        const pattern = prefix + '-' + year + '-%';
        const result = await pool.request()
            .input('year', sql.Int, year)
            .input('pattern', sql.VarChar(50), pattern)
            .query("SELECT ISNULL(MAX(correlative), 0) + 1 AS nextId FROM Quotations WHERE year = @year AND id LIKE @pattern");
        
        res.json({ nextId: result.recordset[0].nextId });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/quotations/next-version/:id', async (req, res) => {
    try {
        const pool = await getDbPool();
        const result = await pool.request()
            .input('id', sql.VarChar(50), req.params.id)
            .query('SELECT ISNULL(MAX(version), 0) + 1 AS nextVersion FROM Quotations WHERE id = @id');
        res.json({ nextVersion: result.recordset[0].nextVersion });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/quotations', async (req, res) => {
    try {
        const q = req.body;
        const pool = await getDbPool();
        await pool.request()
            .input('id', sql.VarChar(50), q.id)
            .input('correlative', sql.Int, q.correlative)
            .input('year', sql.Int, q.year)
            .input('version', sql.Int, q.version || 1)
            .input('clientId', sql.VarChar(50), q.clientId)
            .input('clientName', sql.VarChar(255), q.clientName)
            .input('projectName', sql.VarChar(255), q.projectName || '')
            .input('requirements', sql.VarChar(sql.MAX), q.requirements || '')
            .input('technicalConditions', sql.VarChar(sql.MAX), q.technicalConditions || '')
            .input('commercialConditions', sql.VarChar(sql.MAX), q.commercialConditions || '')
            .input('items1', sql.VarChar(sql.MAX), JSON.stringify(q.items1 || []))
            .input('itemsOptional', sql.VarChar(sql.MAX), JSON.stringify(q.itemsOptional || []))
            .input('subtotal', sql.Decimal(18,2), q.subtotal)
            .input('iva', sql.Decimal(18,2), q.iva)
            .input('total', sql.Decimal(18,2), q.total)
            .input('currency', sql.VarChar(10), q.currency || 'CLP')
            .query(`
                MERGE Quotations AS target
                USING (SELECT @id AS id, @version AS version) AS source
                ON (target.id = source.id AND target.version = source.version)
                WHEN MATCHED THEN
                    UPDATE SET 
                        correlative = @correlative, year = @year, clientId = @clientId,
                        clientName = @clientName, projectName = @projectName,
                        requirements = @requirements, technicalConditions = @technicalConditions,
                        commercialConditions = @commercialConditions, items1 = @items1,
                        itemsOptional = @itemsOptional, subtotal = @subtotal, iva = @iva, total = @total,
                        currency = @currency
                WHEN NOT MATCHED THEN
                    INSERT (id, correlative, year, version, clientId, clientName, projectName, requirements, technicalConditions, commercialConditions, items1, itemsOptional, subtotal, iva, total, currency, createdAt)
                    VALUES (@id, @correlative, @year, @version, @clientId, @clientName, @projectName, @requirements, @technicalConditions, @commercialConditions, @items1, @itemsOptional, @subtotal, @iva, @total, @currency, GETDATE());
            `);

        // --- Sincronización Automática con Proyectos ---
        try {
            const projectId = 'PROJ-' + q.id;
            const versionSuffix = (q.version && q.version > 1) ? ' v' + q.version : '';
            const finalProjectName = (q.projectName || 'Proyecto sin nombre') + versionSuffix;
            const projectStatus = 'Cotizado';

            // Convertir el monto estimado a Pesos Chilenos (CLP) para guardarlo en la tabla de proyectos
            let estimatedAmountClp = q.total;
            let conversionNote = '';
            if (q.currency === 'USD') {
                const rateUSD = q.exchangeRate || await fetchDolar();
                if (rateUSD) {
                    estimatedAmountClp = q.total * rateUSD;
                    conversionNote = ` (${q.total} USD a tasa de $${rateUSD} CLP)`;
                }
            } else if (q.currency === 'UF') {
                const rateUF = q.exchangeRate || await fetchUF();
                if (rateUF) {
                    estimatedAmountClp = q.total * rateUF;
                    conversionNote = ` (${q.total} UF a tasa de $${rateUF} CLP)`;
                }
            }
            // Redondear a CLP entero
            estimatedAmountClp = Math.round(estimatedAmountClp);

            // Verificar si el proyecto ya existe
            const projectCheck = await pool.request()
                .input('id', sql.VarChar(50), projectId)
                .query('SELECT id, status FROM Projects WHERE id = @id');

            if (projectCheck.recordset.length === 0) {
                // Si no existe, crear el proyecto automáticamente en estado 'Cotizado'
                await pool.request()
                    .input('id', sql.VarChar(50), projectId)
                    .input('projectName', sql.VarChar(255), finalProjectName)
                    .input('clientId', sql.VarChar(50), q.clientId)
                    .input('status', sql.VarChar(50), projectStatus)
                    .input('observations', sql.VarChar(sql.MAX), 'Creado automáticamente desde Cotización N° ' + q.id + conversionNote)
                    .input('estimatedAmount', sql.Decimal(18, 2), estimatedAmountClp)
                    .query(`
                        INSERT INTO Projects (id, projectName, clientId, status, observations, estimatedAmount, visitDate) 
                        VALUES (@id, @projectName, @clientId, @status, @observations, @estimatedAmount, GETDATE())
                    `);

                // Registrar en la bitácora de historial del proyecto
                await pool.request()
                    .input('projectId', sql.VarChar(50), projectId)
                    .input('newStatus', sql.VarChar(50), projectStatus)
                    .input('note', sql.VarChar(sql.MAX), 'Creado automáticamente desde Cotización N° ' + q.id + versionSuffix + conversionNote)
                    .query(`
                        INSERT INTO ProjectHistory (projectId, previousStatus, newStatus, note, changeDate) 
                        VALUES (@projectId, NULL, @newStatus, @note, GETDATE())
                    `);
            } else {
                // Si ya existe, actualizamos siempre el nombre y monto, pero NO tocamos el estado 
                // para evitar revivir proyectos eliminados o retroceder proyectos en ejecución.
                const currentStatus = projectCheck.recordset[0].status;
                
                await pool.request()
                    .input('id', sql.VarChar(50), projectId)
                    .input('projectName', sql.VarChar(255), finalProjectName)
                    .input('estimatedAmount', sql.Decimal(18, 2), estimatedAmountClp)
                    .query(`
                        UPDATE Projects 
                        SET projectName = @projectName, estimatedAmount = @estimatedAmount 
                        WHERE id = @id
                    `);

                // Ya no registramos cambio de fase en el historial, porque no cambiamos el estado.
            }
        } catch (projErr) {
            console.error('Error al sincronizar cotización con proyectos:', projErr);
            // No bloqueamos la respuesta de la cotización si falla la creación del proyecto
        }

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/quotations/:id/:version', async (req, res) => {
    try {
        const pool = await getDbPool();
        await pool.request()
            .input('id', sql.VarChar(50), req.params.id)
            .input('version', sql.Int, req.params.version)
            .query('DELETE FROM Quotations WHERE id = @id AND version = @version');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/quotations/save-pdf', async (req, res) => {
    try {
        const { clientName, year, quotationId, projectName, pdfBase64 } = req.body;
        
        // Limpiar base64 header si existe de manera robusta
        const base64Data = pdfBase64.includes('base64,') ? pdfBase64.split('base64,')[1] : pdfBase64;
        const safeProjectName = projectName ? `_${projectName.replace(/[^a-zA-Z0-9 -]/g, '_')}` : '';
        const fileName = `Cotizacion_${quotationId}${safeProjectName}_${clientName.replace(/[^a-zA-Z0-9 -]/g, '')}.pdf`;

        const isWindows = process.platform === 'win32';

        if (isWindows) {
            // Ruta Base en OneDrive (Comportamiento original en Windows)
            const baseDriveDir = path.join('C:', 'Users', 'Richard', 'OneDrive - SIMONS SPA', 'Simons SPA', 'Clientes', 'Cotizaciones APP');
            const yearDir = path.join(baseDriveDir, year.toString());
            const clientDir = path.join(yearDir, clientName);
            
            // Crear directorios si no existen
            if (!fs.existsSync(baseDriveDir)) fs.mkdirSync(baseDriveDir, { recursive: true });
            if (!fs.existsSync(yearDir)) fs.mkdirSync(yearDir, { recursive: true });
            if (!fs.existsSync(clientDir)) fs.mkdirSync(clientDir, { recursive: true });

            const filePath = path.join(clientDir, fileName);
            fs.writeFileSync(filePath, base64Data, 'base64');
            
            console.log(`✅ PDF cotización guardado localmente (Windows): ${filePath}`);
            res.json({ success: true, filePath });
        } else {
            // Comportamiento Linux (Ubuntu Server) con rclone
            const localTempDir = path.join(__dirname, 'temp_pdfs');
            if (!fs.existsSync(localTempDir)) {
                fs.mkdirSync(localTempDir, { recursive: true });
            }
            const localFilePath = path.join(localTempDir, fileName);
            fs.writeFileSync(localFilePath, base64Data, 'base64');
            console.log(`✅ PDF cotización guardado localmente temporal: ${localFilePath}`);

            // Subir a OneDrive usando rclone
            const { execFile } = require('child_process');
            
            // Ruta remota en OneDrive
            const remoteDestDir = `onedrive_backup:Simons SPA/Clientes/Cotizaciones APP/${year}/${clientName}`;
            
            const rcloneArgs = [
                'copy',
                localFilePath,
                remoteDestDir
            ];
            
            // Usar config específico si existe
            const rcloneConfigPath = '/home/administrador/.config/rclone/rclone.conf';
            if (fs.existsSync(rcloneConfigPath)) {
                rcloneArgs.push('--config', rcloneConfigPath);
            }
            
            execFile('/usr/bin/rclone', rcloneArgs, (error, stdout, stderr) => {
                // Eliminar el archivo temporal local de todas formas
                try {
                    if (fs.existsSync(localFilePath)) {
                        fs.unlinkSync(localFilePath);
                    }
                } catch (unlinkErr) {
                    console.error('Error al eliminar PDF temporal:', unlinkErr);
                }

                if (error) {
                    console.error('Error al subir PDF de cotización con rclone:', error);
                    console.error('stderr:', stderr);
                    return res.status(500).json({ error: `Error de subida de documento: ${error.message}` });
                }
                
                console.log(`✅ PDF cotización subido con éxito a OneDrive (${remoteDestDir}/${fileName})`);
                res.json({ success: true, filePath: `${remoteDestDir}/${fileName}` });
            });
        }
    } catch (err) {
        console.error('Error al guardar PDF:', err);
        res.status(500).json({ error: err.message });
    }
});

// --- ENDPOINTS PARA INFORMES ---
app.get('/api/reports', async (req, res) => {
    try {
        const pool = await getDbPool();
        const result = await pool.request().query('SELECT * FROM Reports ORDER BY createdAt DESC');
        console.log(`📦 Historial: Sirviendo ${result.recordset.length} informes.`);
        res.json(result.recordset);
    } catch (err) {
        console.error('Error al obtener informes:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/reports/next-id/:prefixOrId/:year', async (req, res) => {
    try {
        const year = parseInt(req.params.year);
        let prefix = req.params.prefixOrId;
        
        if (prefix.length > 5) {
            const pool = await getDbPool();
            const clientRes = await pool.request()
                .input('id', sql.VarChar(50), prefix)
                .query('SELECT razonSocial, nombreFantasia FROM Clients WHERE id = @id');
            
            if (clientRes.recordset.length > 0) {
                const c = clientRes.recordset[0];
                const nameStr = c.nombreFantasia || c.razonSocial || 'XXX';
                prefix = nameStr.replace(/[^A-Za-z\u00C0-\u017F]/g, '').substring(0, 3).toUpperCase().padEnd(3, 'X');
            } else {
                prefix = prefix.substring(0, 3).toUpperCase();
            }
        }

        const pool = await getDbPool();
        const pattern = 'INF-' + prefix + '-' + year + '-%';
        const result = await pool.request()
            .input('year', sql.Int, year)
            .input('pattern', sql.VarChar(50), pattern)
            .query("SELECT ISNULL(MAX(correlative), 0) + 1 AS nextId FROM Reports WHERE year = @year AND id LIKE @pattern");
        
        res.json({ nextId: result.recordset[0].nextId });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/reports/next-version/:id', async (req, res) => {
    try {
        const pool = await getDbPool();
        const result = await pool.request()
            .input('id', sql.VarChar(50), req.params.id)
            .query('SELECT ISNULL(MAX(version), 0) + 1 AS nextVersion FROM Reports WHERE id = @id');
        res.json({ nextVersion: result.recordset[0].nextVersion });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/reports', async (req, res) => {
    try {
        const r = req.body;
        const pool = await getDbPool();
        await pool.request()
            .input('id', sql.VarChar(50), r.id)
            .input('correlative', sql.Int, r.correlative)
            .input('year', sql.Int, r.year)
            .input('version', sql.Int, r.version || 1)
            .input('clientId', sql.VarChar(50), r.clientId)
            .input('clientName', sql.VarChar(255), r.clientName)
            .input('projectName', sql.VarChar(255), r.projectName || '')
            .input('generalData', sql.VarChar(sql.MAX), r.generalData || '')
            .input('scope', sql.VarChar(sql.MAX), r.scope || '')
            .input('materials', sql.VarChar(sql.MAX), JSON.stringify(r.materials || []))
            .input('results', sql.VarChar(sql.MAX), r.results || '')
            .input('conclusions', sql.VarChar(sql.MAX), r.conclusions || '')
            .input('images', sql.VarChar(sql.MAX), JSON.stringify(r.images || []))
            .query(`
                MERGE Reports AS target
                USING (SELECT @id AS id, @version AS version) AS source
                ON (target.id = source.id AND target.version = source.version)
                WHEN MATCHED THEN
                    UPDATE SET 
                        correlative = @correlative, year = @year, clientId = @clientId,
                        clientName = @clientName, projectName = @projectName,
                        generalData = @generalData, scope = @scope,
                        materials = @materials, results = @results, conclusions = @conclusions,
                        images = @images
                WHEN NOT MATCHED THEN
                    INSERT (id, correlative, year, version, clientId, clientName, projectName, generalData, scope, materials, results, conclusions, images, createdAt)
                    VALUES (@id, @correlative, @year, @version, @clientId, @clientName, @projectName, @generalData, @scope, @materials, @results, @conclusions, @images, GETDATE());
            `);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/reports/:id/:version', async (req, res) => {
    try {
        const pool = await getDbPool();
        await pool.request()
            .input('id', sql.VarChar(50), req.params.id)
            .input('version', sql.Int, req.params.version)
            .query('DELETE FROM Reports WHERE id = @id AND version = @version');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/reports/save-pdf', async (req, res) => {
    try {
        const { clientName, year, reportId, projectName, pdfBase64 } = req.body;
        
        // Limpiar base64 header
        const base64Data = pdfBase64.includes('base64,') ? pdfBase64.split('base64,')[1] : pdfBase64;
        const safeProjectName = projectName ? `_${projectName.replace(/[^a-zA-Z0-9 -]/g, '_')}` : '';
        const fileName = `Informe_${reportId}${safeProjectName}_${clientName.replace(/[^a-zA-Z0-9 -]/g, '')}.pdf`;

        const isWindows = process.platform === 'win32';

        if (isWindows) {
            // Ruta Base en OneDrive para Informes
            const baseDriveDir = path.join('C:', 'Users', 'Richard', 'OneDrive - SIMONS SPA', 'Simons SPA', 'Clientes', 'Informes APP');
            const yearDir = path.join(baseDriveDir, year.toString());
            const clientDir = path.join(yearDir, clientName);
            
            if (!fs.existsSync(baseDriveDir)) fs.mkdirSync(baseDriveDir, { recursive: true });
            if (!fs.existsSync(yearDir)) fs.mkdirSync(yearDir, { recursive: true });
            if (!fs.existsSync(clientDir)) fs.mkdirSync(clientDir, { recursive: true });

            const filePath = path.join(clientDir, fileName);
            fs.writeFileSync(filePath, base64Data, 'base64');
            
            console.log(`✅ PDF informe guardado localmente (Windows): ${filePath}`);
            res.json({ success: true, filePath });
        } else {
            // Comportamiento Linux (Ubuntu Server) con rclone
            const localTempDir = path.join(__dirname, 'temp_pdfs');
            if (!fs.existsSync(localTempDir)) {
                fs.mkdirSync(localTempDir, { recursive: true });
            }
            const localFilePath = path.join(localTempDir, fileName);
            fs.writeFileSync(localFilePath, base64Data, 'base64');
            console.log(`✅ PDF informe guardado localmente temporal: ${localFilePath}`);

            const { execFile } = require('child_process');
            
            // Ruta remota en OneDrive para Informes
            const remoteDestDir = `onedrive_backup:Simons SPA/Clientes/Informes APP/${year}/${clientName}`;
            
            const rcloneArgs = [
                'copy',
                localFilePath,
                remoteDestDir
            ];
            
            const rcloneConfigPath = '/home/administrador/.config/rclone/rclone.conf';
            if (fs.existsSync(rcloneConfigPath)) {
                rcloneArgs.push('--config', rcloneConfigPath);
            }
            
            execFile('/usr/bin/rclone', rcloneArgs, (error, stdout, stderr) => {
                try {
                    if (fs.existsSync(localFilePath)) {
                        fs.unlinkSync(localFilePath);
                    }
                } catch (unlinkErr) {
                    console.error('Error al eliminar PDF temporal de informe:', unlinkErr);
                }

                if (error) {
                    console.error('Error al subir PDF de informe con rclone:', error);
                    console.error('stderr:', stderr);
                    return res.status(500).json({ error: `Error de subida de documento: ${error.message}` });
                }
                
                console.log(`✅ PDF informe subido con éxito a OneDrive (${remoteDestDir}/${fileName})`);
                res.json({ success: true, filePath: `${remoteDestDir}/${fileName}` });
            });
        }
    } catch (err) {
        console.error('Error al guardar PDF de informe:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/debtors/upload-invoice', async (req, res) => {
    try {
        const { clientName, year, debtorId, description, pdfBase64, originalFileName } = req.body;

        if (!pdfBase64) {
            return res.status(400).json({ error: 'No se recibió archivo' });
        }

        // Limpiar base64 header si existe
        const base64Data = pdfBase64.includes('base64,') ? pdfBase64.split('base64,')[1] : pdfBase64;
        const safeDescription = description ? `_${description.replace(/[^a-zA-Z0-9 -]/g, '_')}` : '';
        const safeClientName = clientName.replace(/[^a-zA-Z0-9 -]/g, '');
        const ext = (originalFileName && originalFileName.includes('.')) ? originalFileName.split('.').pop() : 'pdf';
        const fileName = `Factura_${debtorId}${safeDescription}_${safeClientName}.${ext}`;

        const isWindows = process.platform === 'win32';

        // Helper: guarda invoicePath en la BD directamente — no depende del cliente
        // Así el path queda guardado aunque el usuario cierre la pestaña o cambie de vista
        const saveInvoicePathToDB = async (invoicePath) => {
            try {
                const pool = await getDbPool();
                await pool.request()
                    .input('id', sql.VarChar(50), debtorId)
                    .input('invoicePath', sql.VarChar(sql.MAX), invoicePath)
                    .query(`UPDATE Debtors SET invoicePath=@invoicePath WHERE id=@id`);
                console.log(`✅ invoicePath guardado en BD para deudor ${debtorId}`);
            } catch (dbErr) {
                console.error('Error al guardar invoicePath en BD:', dbErr.message);
            }
        };

        if (isWindows) {
            const baseDriveDir = path.join('C:', 'Users', 'Richard', 'OneDrive - SIMONS SPA', 'Simons SPA', 'Clientes', 'Facturas APP');
            const yearDir = path.join(baseDriveDir, year.toString());
            const clientDir = path.join(yearDir, clientName);

            if (!fs.existsSync(baseDriveDir)) fs.mkdirSync(baseDriveDir, { recursive: true });
            if (!fs.existsSync(yearDir)) fs.mkdirSync(yearDir, { recursive: true });
            if (!fs.existsSync(clientDir)) fs.mkdirSync(clientDir, { recursive: true });

            const filePath = path.join(clientDir, fileName);
            fs.writeFileSync(filePath, base64Data, 'base64');

            await saveInvoicePathToDB(filePath);
            console.log(`✅ Factura guardada localmente (Windows): ${filePath}`);
            res.json({ success: true, filePath });
        } else {
            // Comportamiento Linux (Ubuntu Server) con rclone
            const localTempDir = path.join(__dirname, 'temp_pdfs');
            if (!fs.existsSync(localTempDir)) {
                fs.mkdirSync(localTempDir, { recursive: true });
            }
            const localFilePath = path.join(localTempDir, fileName);
            fs.writeFileSync(localFilePath, base64Data, 'base64');
            console.log(`✅ Factura guardada localmente temporal: ${localFilePath}`);

            const { execFile } = require('child_process');

            // Ruta remota en OneDrive para Facturas
            const remoteDestDir = `onedrive_backup:Simons SPA/Clientes/Facturas APP/${year}/${clientName}`;

            const rcloneArgs = [
                'copy',
                localFilePath,
                remoteDestDir
            ];

            const rcloneConfigPath = '/home/administrador/.config/rclone/rclone.conf';
            if (fs.existsSync(rcloneConfigPath)) {
                rcloneArgs.push('--config', rcloneConfigPath);
            }

            execFile('/usr/bin/rclone', rcloneArgs, async (error, stdout, stderr) => {
                try {
                    if (fs.existsSync(localFilePath)) {
                        fs.unlinkSync(localFilePath);
                    }
                } catch (unlinkErr) {
                    console.error('Error al eliminar factura temporal:', unlinkErr);
                }

                if (error) {
                    console.error('Error al subir factura con rclone:', error);
                    console.error('stderr:', stderr);
                    return res.status(500).json({ error: `Error de subida de documento: ${error.message}` });
                }

                const finalPath = `${remoteDestDir}/${fileName}`;
                // Guardar en BD ANTES de responder al cliente — robusto ante desconexiones
                await saveInvoicePathToDB(finalPath);
                console.log(`✅ Factura subida con éxito a OneDrive (${finalPath})`);
                res.json({ success: true, filePath: finalPath });
            });
        }
    } catch (err) {
        console.error('Error al guardar factura:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/transactions/upload-invoice', async (req, res) => {
    try {
        const { providerName, year, transactionId, description, pdfBase64, originalFileName } = req.body;

        if (!pdfBase64) {
            return res.status(400).json({ error: 'No se recibió archivo' });
        }

        // Limpiar base64 header si existe
        const base64Data = pdfBase64.includes('base64,') ? pdfBase64.split('base64,')[1] : pdfBase64;
        const safeDescription = description ? `_${description.replace(/[^a-zA-Z0-9 -]/g, '_')}` : '';
        const safeProviderName = providerName ? providerName.replace(/[^a-zA-Z0-9 -]/g, '') : 'Varios';
        const ext = (originalFileName && originalFileName.includes('.')) ? originalFileName.split('.').pop() : 'pdf';
        const fileName = `Comprobante_${transactionId}${safeDescription}_${safeProviderName}.${ext}`;

        const isWindows = process.platform === 'win32';

        const saveInvoicePathToDB = async (invoicePath) => {
            try {
                const pool = await getDbPool();
                await pool.request()
                    .input('id', sql.VarChar(50), transactionId)
                    .input('invoicePath', sql.VarChar(sql.MAX), invoicePath)
                    .query(`UPDATE Transactions SET invoicePath=@invoicePath WHERE id=@id`);
                console.log(`✅ invoicePath guardado en BD para transacción ${transactionId}`);
            } catch (dbErr) {
                console.error('Error al guardar invoicePath en BD para transacción:', dbErr.message);
            }
        };

        if (isWindows) {
            const baseDriveDir = path.join('C:', 'Users', 'Richard', 'OneDrive - SIMONS SPA', 'Simons SPA', 'Clientes', 'Movimientos');
            const yearDir = path.join(baseDriveDir, year.toString());
            const providerDir = path.join(yearDir, safeProviderName);

            if (!fs.existsSync(baseDriveDir)) fs.mkdirSync(baseDriveDir, { recursive: true });
            if (!fs.existsSync(yearDir)) fs.mkdirSync(yearDir, { recursive: true });
            if (!fs.existsSync(providerDir)) fs.mkdirSync(providerDir, { recursive: true });

            const filePath = path.join(providerDir, fileName);
            fs.writeFileSync(filePath, base64Data, 'base64');

            await saveInvoicePathToDB(filePath);
            console.log(`✅ Comprobante guardado localmente (Windows): ${filePath}`);
            res.json({ success: true, filePath });
        } else {
            // Comportamiento Linux (Ubuntu Server) con rclone
            const localTempDir = path.join(__dirname, 'temp_pdfs');
            if (!fs.existsSync(localTempDir)) {
                fs.mkdirSync(localTempDir, { recursive: true });
            }
            const localFilePath = path.join(localTempDir, fileName);
            fs.writeFileSync(localFilePath, base64Data, 'base64');
            console.log(`✅ Comprobante guardado localmente temporal: ${localFilePath}`);

            const { execFile } = require('child_process');

            // Ruta remota en OneDrive para Movimientos
            const remoteDestDir = `onedrive_backup:Simons SPA/Clientes/Movimientos/${year}/${safeProviderName}`;

            const rcloneArgs = [
                'copy',
                localFilePath,
                remoteDestDir
            ];

            const rcloneConfigPath = '/home/administrador/.config/rclone/rclone.conf';
            if (fs.existsSync(rcloneConfigPath)) {
                rcloneArgs.push('--config', rcloneConfigPath);
            }

            execFile('/usr/bin/rclone', rcloneArgs, async (error, stdout, stderr) => {
                try {
                    if (fs.existsSync(localFilePath)) {
                        fs.unlinkSync(localFilePath);
                    }
                } catch (unlinkErr) {
                    console.error('Error al eliminar comprobante temporal:', unlinkErr);
                }

                if (error) {
                    console.error('Error al subir comprobante con rclone:', error);
                    console.error('stderr:', stderr);
                    return res.status(500).json({ error: `Error de subida de documento: ${error.message}` });
                }

                const finalPath = `${remoteDestDir}/${fileName}`;
                await saveInvoicePathToDB(finalPath);
                console.log(`✅ Comprobante subido con éxito a OneDrive (${finalPath})`);
                res.json({ success: true, filePath: finalPath });
            });
        }
    } catch (err) {
        console.error('Error al guardar comprobante de movimiento:', err);
        res.status(500).json({ error: err.message });
    }
});

// Helper para eliminar archivos de manera robusta (Windows local o Linux rclone con fallback)
const deleteRemoteFile = (invoicePath) => {
    return new Promise((resolve) => {
        if (!invoicePath) return resolve(true);

        const isWindows = process.platform === 'win32';
        if (isWindows) {
            const fs = require('fs');
            if (fs.existsSync(invoicePath)) {
                fs.unlink(invoicePath, (err) => {
                    if (err) {
                        console.error('Error al eliminar archivo local:', err);
                    } else {
                        console.log('✅ Archivo local eliminado:', invoicePath);
                    }
                    resolve(true);
                });
            } else {
                resolve(true);
            }
        } else {
            const { execFile } = require('child_process');
            const fs = require('fs');
            const rcloneConfigPath = '/home/administrador/.config/rclone/rclone.conf';
            
            const runRclone = (args) => {
                return new Promise((res, rej) => {
                    const argsWithConfig = [...args];
                    if (fs.existsSync(rcloneConfigPath)) {
                        argsWithConfig.push('--config', rcloneConfigPath);
                    }
                    execFile('/usr/bin/rclone', argsWithConfig, (err, stdout, stderr) => {
                        if (err) {
                            rej({ err, stderr });
                        } else {
                            res(stdout);
                        }
                    });
                });
            };

            // 1. Intentar deletefile (más rápido y limpio para archivos individuales)
            runRclone(['deletefile', invoicePath])
                .then(() => {
                    console.log('✅ Archivo eliminado con deletefile:', invoicePath);
                    resolve(true);
                })
                .catch((errorInfo) => {
                    console.warn('⚠️ Falló deletefile, intentando delete con --include...', errorInfo.err.message);
                    
                    // 2. Fallback: usar delete con filtro --include (soportado en todas las versiones de rclone)
                    const lastSlashIndex = invoicePath.lastIndexOf('/');
                    if (lastSlashIndex !== -1) {
                        const dirPath = invoicePath.substring(0, lastSlashIndex);
                        const fileName = invoicePath.substring(lastSlashIndex + 1);
                        
                        runRclone(['delete', dirPath, '--include', fileName])
                            .then(() => {
                                console.log('✅ Archivo eliminado con delete --include:', invoicePath);
                                resolve(true);
                            })
                            .catch((fallbackErr) => {
                                console.error('❌ Falló también el método fallback de eliminación:', fallbackErr.err.message);
                                resolve(false);
                            });
                    } else {
                        resolve(false);
                    }
                });
        }
    });
};

// --- ENPOINTS DE DESCARGA Y ELIMINACION DE FACTURAS/COMPROBANTES (ONEDRIVE) ---

app.get('/api/debtors/:id/download-invoice', async (req, res) => {
    try {
        const pool = await getDbPool();
        const result = await pool.request()
            .input('id', sql.VarChar(50), req.params.id)
            .query('SELECT invoicePath FROM Debtors WHERE id = @id');
        
        if (result.recordset.length === 0 || !result.recordset[0].invoicePath) {
            return res.status(404).send('Factura no encontrada o no cargada.');
        }

        const invoicePath = result.recordset[0].invoicePath;
        const isWindows = process.platform === 'win32';
        const fileName = path.basename(invoicePath);

        if (isWindows) {
            if (fs.existsSync(invoicePath)) {
                res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
                res.sendFile(invoicePath);
            } else {
                res.status(404).send('Archivo local no encontrado en el servidor.');
            }
        } else {
            // Linux + rclone
            const { spawn } = require('child_process');
            
            const rcloneArgs = ['cat', invoicePath];
            const rcloneConfigPath = '/home/administrador/.config/rclone/rclone.conf';
            if (fs.existsSync(rcloneConfigPath)) {
                rcloneArgs.push('--config', rcloneConfigPath);
            }

            res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
            
            // Tipo de contenido
            const ext = fileName.split('.').pop().toLowerCase();
            if (ext === 'pdf') res.setHeader('Content-Type', 'application/pdf');
            else if (ext === 'png') res.setHeader('Content-Type', 'image/png');
            else if (ext === 'jpg' || ext === 'jpeg') res.setHeader('Content-Type', 'image/jpeg');

            const child = spawn('/usr/bin/rclone', rcloneArgs);
            child.stdout.pipe(res);
            child.stderr.on('data', (data) => {
                console.error(`rclone cat stderr: ${data}`);
            });
            child.on('error', (err) => {
                console.error('rclone spawn error:', err);
                if (!res.headersSent) {
                    res.status(500).send(`Error de descarga: ${err.message}`);
                }
            });
        }
    } catch (err) {
        console.error('Error al descargar factura:', err);
        res.status(500).send('Error interno del servidor.');
    }
});

app.get('/api/transactions/:id/download-invoice', async (req, res) => {
    try {
        const pool = await getDbPool();
        const result = await pool.request()
            .input('id', sql.VarChar(50), req.params.id)
            .query('SELECT invoicePath FROM Transactions WHERE id = @id');
        
        if (result.recordset.length === 0 || !result.recordset[0].invoicePath) {
            return res.status(404).send('Comprobante no encontrado o no cargado.');
        }

        const invoicePath = result.recordset[0].invoicePath;
        const isWindows = process.platform === 'win32';
        const fileName = path.basename(invoicePath);

        if (isWindows) {
            if (fs.existsSync(invoicePath)) {
                res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
                res.sendFile(invoicePath);
            } else {
                res.status(404).send('Archivo local no encontrado en el servidor.');
            }
        } else {
            // Linux + rclone
            const { spawn } = require('child_process');
            
            const rcloneArgs = ['cat', invoicePath];
            const rcloneConfigPath = '/home/administrador/.config/rclone/rclone.conf';
            if (fs.existsSync(rcloneConfigPath)) {
                rcloneArgs.push('--config', rcloneConfigPath);
            }

            res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
            
            const ext = fileName.split('.').pop().toLowerCase();
            if (ext === 'pdf') res.setHeader('Content-Type', 'application/pdf');
            else if (ext === 'png') res.setHeader('Content-Type', 'image/png');
            else if (ext === 'jpg' || ext === 'jpeg') res.setHeader('Content-Type', 'image/jpeg');

            const child = spawn('/usr/bin/rclone', rcloneArgs);
            child.stdout.pipe(res);
            child.stderr.on('data', (data) => {
                console.error(`rclone cat stderr: ${data}`);
            });
            child.on('error', (err) => {
                console.error('rclone spawn error:', err);
                if (!res.headersSent) {
                    res.status(500).send(`Error de descarga: ${err.message}`);
                }
            });
        }
    } catch (err) {
        console.error('Error al descargar comprobante:', err);
        res.status(500).send('Error interno del servidor.');
    }
});

app.delete('/api/debtors/:id/invoice', async (req, res) => {
    try {
        const pool = await getDbPool();
        const result = await pool.request()
            .input('id', sql.VarChar(50), req.params.id)
            .query('SELECT invoicePath FROM Debtors WHERE id = @id');
        
        if (result.recordset.length === 0 || !result.recordset[0].invoicePath) {
            return res.status(404).json({ error: 'No hay factura asociada para eliminar.' });
        }

        const invoicePath = result.recordset[0].invoicePath;

        // 1. Limpiar de la BD
        await pool.request()
            .input('id', sql.VarChar(50), req.params.id)
            .query('UPDATE Debtors SET invoicePath = NULL WHERE id = @id');

        // 2. Eliminar del almacenamiento remoto
        deleteRemoteFile(invoicePath); // Se ejecuta en segundo plano

        res.json({ success: true });
    } catch (err) {
        console.error('Error al eliminar factura de deudor:', err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/transactions/:id/invoice', async (req, res) => {
    try {
        const pool = await getDbPool();
        const result = await pool.request()
            .input('id', sql.VarChar(50), req.params.id)
            .query('SELECT invoicePath FROM Transactions WHERE id = @id');
        
        if (result.recordset.length === 0 || !result.recordset[0].invoicePath) {
            return res.status(404).json({ error: 'No hay comprobante asociado para eliminar.' });
        }

        const invoicePath = result.recordset[0].invoicePath;

        // 1. Limpiar de la BD
        await pool.request()
            .input('id', sql.VarChar(50), req.params.id)
            .query('UPDATE Transactions SET invoicePath = NULL WHERE id = @id');

        // 2. Eliminar del almacenamiento remoto
        deleteRemoteFile(invoicePath); // Se ejecuta en segundo plano

        res.json({ success: true });
    } catch (err) {
        console.error('Error al eliminar comprobante de transacción:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/reports/upload-image', upload.single('image'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No se subió ninguna imagen' });
    const imageUrl = `/uploads/${req.file.filename}`;
    res.json({ url: imageUrl });
});

// --- ENDPOINTS PARA LOGS ---
app.get('/api/logs', async (req, res) => {
    try {
        const pool = await getDbPool();
        const result = await pool.request().query('SELECT TOP 100 * FROM Logs ORDER BY timestamp DESC');
        const logs = result.recordset.map(l => ({
            ...l,
            category: l.module, // Alias para compatibilidad con código antiguo
            extraData: l.extraData ? JSON.parse(l.extraData) : null
        }));
        res.json(logs);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.post('/api/logs', async (req, res) => {
    try {
        const l = req.body;
        const pool = await getDbPool();
        await pool.request()
            .input('id', sql.VarChar(50), l.id)
            .input('action', sql.VarChar(50), l.action)
            .input('module', sql.VarChar(50), l.module)
            .input('userName', sql.VarChar(100), l.userName || 'Sistema')
            .input('details', sql.VarChar(sql.MAX), l.details || '')
            .input('timestamp', sql.DateTime, new Date(l.timestamp))
            .input('extraData', sql.VarChar(sql.MAX), l.extraData ? JSON.stringify(l.extraData) : null)
            .query(`INSERT INTO Logs (id, action, module, userName, details, timestamp, extraData) VALUES (@id, @action, @module, @userName, @details, @timestamp, @extraData)`);
        res.json(l);
    } catch (err) {
        console.error('Error in POST /api/logs:', err);
        res.status(500).json({ error: err.message });
    }
});

const http = require('http');
const https = require('https');

const HTTP_PORT  = parseInt(process.env.PORT)        || 3000;
const HTTPS_PORT = parseInt(process.env.HTTPS_PORT)  || 3443;

// Función para detectar IP de red local
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

// Función de inicio de tareas de mantenimiento
async function runMaintenanceTasks() {
    try {

        await deleteExpiredNotes();
        await cleanOldQuotations();
        await syncQuotationsToProjects();
    } catch (mErr) {
        console.error('⚠️ Error en tareas de mantenimiento iniciales:', mErr.message);
    }
}

// Intentar iniciar servidor HTTPS con certificado
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

// Servidor HTTP:
// - Si viene de Cloudflare/proxy (X-Forwarded-Proto: https o CF-Ray), sirve directamente (Cloudflare ya maneja HTTPS)
// - Si es acceso HTTP directo local y hay HTTPS activo, redirige a HTTPS
// - Si no hay HTTPS activo, sirve directamente
const httpApp = http.createServer((req, res) => {
    const forwardedProto = req.headers['x-forwarded-proto'];
    const cfRay           = req.headers['cf-ray'];      // Header exclusivo de Cloudflare
    const isProxiedHttps  = forwardedProto === 'https' || !!cfRay;

    console.log(`[HTTP Request] Path: ${req.url}, Host: ${req.headers.host}, x-forwarded-proto: ${forwardedProto}, cf-ray: ${cfRay}, isProxiedHttps: ${isProxiedHttps}`);

    if (httpsActive && !isProxiedHttps) {
        // Acceso HTTP directo sin proxy → redirigir a HTTPS local
        const host = (req.headers.host || 'localhost').replace(`:${HTTP_PORT}`, `:${HTTPS_PORT}`);
        console.log(`[HTTP Redirect] Redirecting to https://${host}${req.url}`);
        res.writeHead(301, { Location: `https://${host}${req.url}` });
        res.end();
    } else {
        // Viene de Cloudflare (ya es HTTPS en el borde) o no hay HTTPS → servir app
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

// Manejo global de errores para evitar cierres inesperados
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught Exception:', err);
    // En producción podrías querer cerrar ordenadamente, pero aquí evitamos el loop de crash directo
    // process.exit(1); 
});

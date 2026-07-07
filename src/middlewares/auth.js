const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'contaeste_super_secret_key_2026!';

const requireAuth = (req, res, next) => {
    // Si la ruta es de autenticación pública, dejamos pasar
    if (req.path.startsWith('/auth/') || req.path.startsWith('/api/auth/')) return next();

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
    if (req.method === 'GET') return next();
    if (req.path.startsWith('/api/auth/') || req.path.startsWith('/auth/')) return next();
    if (req.path.startsWith('/api/logs') || req.path.startsWith('/logs')) return next(); // anyone can log

    if (!req.user) return res.status(401).json({ error: 'No autenticado' });
    if (req.user.role === 'administrador') return next();

    // Encontrar el módulo correspondiente por prefijo de ruta (original o con prefijo /api)
    let pathToCheck = req.path;
    if (!pathToCheck.startsWith('/api') && req.baseUrl.startsWith('/api')) {
        pathToCheck = req.baseUrl + req.path;
    }

    let requiredModule = null;
    for (const [route, mod] of Object.entries(routeModuleMap)) {
        if (pathToCheck.startsWith(route)) {
            requiredModule = mod;
            break;
        }
    }

    if (requiredModule) {
        if (req.user.modules && req.user.modules.includes(requiredModule)) {
            return next();
        } else {
            console.warn(`[RBAC Bloqueado] ${req.user.email} intentó acceder a ${pathToCheck} sin el módulo ${requiredModule}`);
            return res.status(403).json({ error: `Acceso denegado. Se requiere el módulo: ${requiredModule}` });
        }
    }

    next();
};

module.exports = {
    requireAuth,
    rbacMiddleware
};

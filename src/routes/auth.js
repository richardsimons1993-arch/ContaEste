const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const { getDbPool, sql } = require("../config/db");

const JWT_SECRET = process.env.JWT_SECRET || "contaeste_super_secret_key_2026!";

// --- Rate Limiter Anti-Fuerza Bruta & Anti-Bots en Memoria ---
const loginAttempts = new Map();
const MAX_ATTEMPTS = 5;
const LOCKOUT_TIME = 15 * 60 * 1000; // 15 minutos

function rateLimitLogin(req, res, next) {
    const clientIp = req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
    const now = Date.now();
    const record = loginAttempts.get(clientIp);

    if (record) {
        if (now < record.lockUntil) {
            const minutesLeft = Math.ceil((record.lockUntil - now) / 60000);
            return res.status(429).json({
                error: `Demasiados intentos fallidos. Por seguridad, el acceso está bloqueado temporalmente. Intente nuevamente en ${minutesLeft} minuto(s).`
            });
        }
        // Expiró el bloqueo, resetear
        if (now >= record.lockUntil && record.lockUntil > 0) {
            loginAttempts.delete(clientIp);
        }
    }
    next();
}

function recordFailedAttempt(clientIp) {
    const now = Date.now();
    const record = loginAttempts.get(clientIp) || { attempts: 0, lockUntil: 0 };
    record.attempts += 1;
    if (record.attempts >= MAX_ATTEMPTS) {
        record.lockUntil = now + LOCKOUT_TIME;
        console.warn(`[SEGURIDAD] IP ${clientIp} bloqueada por ${LOCKOUT_TIME / 60000} minutos tras ${record.attempts} intentos fallidos.`);
    }
    loginAttempts.set(clientIp, record);
}

function resetFailedAttempts(clientIp) {
    loginAttempts.delete(clientIp);
}

// Limpieza periódica de registros antiguos cada 30 minutos
setInterval(() => {
    const now = Date.now();
    for (const [ip, record] of loginAttempts.entries()) {
        if (now > record.lockUntil && (now - record.lockUntil) > 3600000) {
            loginAttempts.delete(ip);
        }
    }
}, 30 * 60 * 1000);

// POST /api/auth/login (Autenticación Local Blindada con Anti-Fuerza Bruta)
async function handleLogin(req, res) {
    const clientIp = req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
    const { username, email, usernameOrEmail, password } = req.body || {};
    const identifier = (usernameOrEmail || username || email || "").toLowerCase().trim();
    const rawPassword = password || "";

    if (!identifier || !rawPassword) {
        return res.status(400).json({ error: "Por favor ingresa usuario/correo y contraseña." });
    }

    try {
        const pool = await getDbPool();
        const result = await pool.request()
            .input("Identifier", sql.NVarChar(255), identifier)
            .query("SELECT id, username, role, name, modules, email, password FROM Users WHERE LOWER(username) = @Identifier OR LOWER(Email) = @Identifier");

        if (result.recordset.length === 0) {
            recordFailedAttempt(clientIp);
            return res.status(401).json({ error: "Usuario o contraseña incorrectos." });
        }

        const user = result.recordset[0];
        if (!user.password) {
            return res.status(401).json({ error: "El usuario no tiene contraseña configurada. Contacte al administrador." });
        }

        const passwordMatch = await bcrypt.compare(rawPassword, user.password);
        if (!passwordMatch) {
            recordFailedAttempt(clientIp);
            return res.status(401).json({ error: "Usuario o contraseña incorrectos." });
        }

        // Login exitoso: limpiar historial de intentos fallidos
        resetFailedAttempts(clientIp);

        const sessionModules = user.modules ? JSON.parse(user.modules) : [];
        const jwtToken = jwt.sign({ 
            id: user.id, 
            username: user.username,
            email: user.email, 
            role: user.role, 
            modules: sessionModules 
        }, JWT_SECRET, { expiresIn: "12h" });

        const sessionData = {
            id: user.id,
            username: user.username,
            email: user.email || user.username,
            role: user.role,
            name: user.name || user.username,
            modules: sessionModules,
            lastActivity: Date.now(),
            token: jwtToken
        };

        return res.json({ success: true, user: sessionData, token: jwtToken });
    } catch (err) {
        console.error("Error en autenticación:", err.message);
        return res.status(500).json({ error: "Error interno en el servidor." });
    }
}

router.post("/login", rateLimitLogin, express.json(), handleLogin);
router.post("/login-local", rateLimitLogin, express.json(), handleLogin);

router.get("/signin", (req, res) => res.redirect("/"));
router.get("/redirect", (req, res) => res.redirect("/"));

module.exports = router;

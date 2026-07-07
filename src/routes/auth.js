const express = require('express');
const router = express.Router();
const msal = require('@azure/msal-node');
const jwt = require('jsonwebtoken');
const { getDbPool, sql } = require('../config/db');

const JWT_SECRET = process.env.JWT_SECRET || 'contaeste_super_secret_key_2026!';

const msalConfigAuth = {
    auth: {
        clientId: process.env.AZURE_CLIENT_ID,
        authority: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}`,
        clientSecret: process.env.AZURE_CLIENT_SECRET,
    }
};

const pca = new msal.ConfidentialClientApplication(msalConfigAuth);

// GET /api/auth/signin
router.get('/signin', (req, res) => {
    const authCodeUrlParameters = {
        scopes: ["user.read"],
        redirectUri: "https://admin.simons.cl/api/auth/redirect",
    };
    pca.getAuthCodeUrl(authCodeUrlParameters).then((response) => {
        res.redirect(response);
    }).catch((error) => {
        console.error('Error getting auth code URL:', error);
        res.status(500).send("Error iniciando login corporativo.");
    });
});

// GET /api/auth/redirect
router.get('/redirect', (req, res) => {
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

            res.send(`<script>
                localStorage.setItem('contabilidad_session', JSON.stringify(${JSON.stringify(sessionData)}));
                window.location.href = '/';
            </script>`);
        } catch (err) {
            console.error('Error en SSO auth:', err.message);
            res.status(500).send("Error interno validando usuario.");
        }
    }).catch((error) => {
        console.error('Error acquiring token by code:', error);
        res.status(500).send("Error de autenticación SSO.");
    });
});

module.exports = router;

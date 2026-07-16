const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const multer = require('multer');
const { getDbPool, sql, getApi, deleteApi } = require('../config/db');

const PROJECT_ROOT = path.join(__dirname, '../..');
const UPLOADS_DIR = path.join(PROJECT_ROOT, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

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

// CONFIGURACIÓN MICROSOFT GRAPH API (CRM)
let GRAPH_CONFIG = {
    tenantId: '',
    clientId: '',
    clientSecret: '',
    senderEmail: ''
};

try {
    const configPath = path.join(PROJECT_ROOT, 'config_crm.json');
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
        console.error('❌ Error obteniendo token de Graph. Config actual:', {
            tenantId: GRAPH_CONFIG.tenantId,
            clientId: GRAPH_CONFIG.clientId,
            senderEmail: GRAPH_CONFIG.senderEmail,
            secretLength: GRAPH_CONFIG.clientSecret ? GRAPH_CONFIG.clientSecret.length : 0
        });
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Data:', JSON.stringify(error.response.data));
        } else {
            console.error('Message:', error.message);
        }
        throw new Error('No se pudo autenticar con Microsoft Graph');
    }
}

// Routes
router.get('/prospectos', (req, res) => getApi(req, res, 'CRM_Prospectos'));
router.delete('/prospectos/:id', (req, res) => deleteApi(req, res, 'CRM_Prospectos'));

router.post('/prospectos', async (req, res) => {
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

router.get('/calls/:prospectoId', async (req, res) => {
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

router.post('/calls', async (req, res) => {
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

router.post('/send-emails', async (req, res) => {
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
                    const filePath = path.join(UPLOADS_DIR, filename);

                    if (fs.existsSync(filePath)) {
                        const fileContent = fs.readFileSync(filePath, { encoding: 'base64' });
                        const extension = filename.split('.').pop().toLowerCase();
                        const mimeType = `image/${extension === 'jpg' ? 'jpeg' : extension}`;
                        const contentId = `img${cidCounter++}@crm`;

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

                // Registrar en la base de datos
                try {
                    await pool.request()
                        .input('logId', sql.VarChar(50), Date.now().toString() + Math.floor(Math.random() * 1000).toString())
                        .input('action', sql.VarChar(50), 'Envío Email CRM')
                        .input('module', sql.VarChar(50), 'CRM')
                        .input('userName', sql.VarChar(100), req.user ? req.user.email : 'Sistema')
                        .input('details', sql.VarChar(sql.MAX), `Correo masivo CRM enviado a: ${email} (Asunto: ${subject})`)
                        .input('timestamp', sql.DateTime, new Date())
                        .input('extraData', sql.VarChar(sql.MAX), JSON.stringify({ email, subject, success: true }))
                        .query(`INSERT INTO Logs (id, action, module, userName, details, timestamp, extraData) VALUES (@logId, @action, @module, @userName, @details, @timestamp, @extraData)`);
                } catch (logErr) {
                    console.error('Error logging CRM email success to DB:', logErr.message);
                }
                
                if (sentCount < recipients.length) {
                    await delay(1500); 
                }
            } catch (err) {
                const errorDetail = err.response ? JSON.stringify(err.response.data) : err.message;
                console.error(`❌ [Graph] Error enviando a ${email}:`, errorDetail);
                results.push({ email, success: false, error: errorDetail });

                // Registrar el error en la base de datos
                try {
                    await pool.request()
                        .input('logId', sql.VarChar(50), Date.now().toString() + Math.floor(Math.random() * 1000).toString())
                        .input('action', sql.VarChar(50), 'Error Email CRM')
                        .input('module', sql.VarChar(50), 'CRM')
                        .input('userName', sql.VarChar(100), req.user ? req.user.email : 'Sistema')
                        .input('details', sql.VarChar(sql.MAX), `Error al enviar correo masivo CRM a: ${email} (Asunto: ${subject}) - Error: ${errorDetail}`)
                        .input('timestamp', sql.DateTime, new Date())
                        .input('extraData', sql.VarChar(sql.MAX), JSON.stringify({ email, subject, success: false, error: errorDetail }))
                        .query(`INSERT INTO Logs (id, action, module, userName, details, timestamp, extraData) VALUES (@logId, @action, @module, @userName, @details, @timestamp, @extraData)`);
                } catch (logErr) {
                    console.error('Error logging CRM email error to DB:', logErr.message);
                }
            }
        }

        res.json({ success: true, sent: sentCount, results });
    } catch (err) {
        console.error('❌ Error general en envío Graph:', err.message);
        res.status(500).json({ error: 'Error en Microsoft Graph: ' + err.message });
    }
});

router.post('/upload-image', upload.single('image'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No se subió ninguna imagen' });
    const imageUrl = `/uploads/${req.file.filename}`;
    res.json({ url: imageUrl });
});

module.exports = router;

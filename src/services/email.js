const nodemailer = require('nodemailer');
const { getDbPool, sql } = require('../config/db');

// Configuración SMTP para Brevo Relay / Mailcow
const SMTP_HOST = process.env.SMTP_HOST || 'smtp-relay.brevo.com';
const SMTP_PORT = parseInt(process.env.SMTP_PORT, 10) || 587;
const SMTP_SECURE = process.env.SMTP_SECURE === 'true';
const SMTP_USER = process.env.SMTP_USER || 'be25dd001@smtp-brevo.com';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_FROM = process.env.SMTP_FROM || '"Simons SpA" <richard@simons.cl>';

const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: {
        user: SMTP_USER,
        pass: SMTP_PASS
    },
    tls: {
        rejectUnauthorized: false
    }
});

// Verificación inicial de transporte
transporter.verify((err, success) => {
    if (err) {
        console.warn(`⚠️ Error en conexión SMTP ContaEste (${SMTP_HOST}:${SMTP_PORT}):`, err.message);
    } else {
        console.log(`✅ Servidor SMTP ContaEste listo en ${SMTP_HOST}:${SMTP_PORT}`);
    }
});

async function logEmailEvent(success, to, subject, errorMsg = null) {
    try {
        const pool = await getDbPool();
        const action = success ? 'Envío Email' : 'Error Email';
        const details = success 
            ? `Correo enviado vía SMTP a: ${to} (Asunto: ${subject})`
            : `Error enviando correo vía SMTP a: ${to} (Asunto: ${subject}) - Error: ${errorMsg}`;
        const extraData = JSON.stringify({ to, subject, success, error: errorMsg });

        await pool.request()
            .input('id', sql.VarChar(50), Date.now().toString() + Math.floor(Math.random() * 1000).toString())
            .input('action', sql.VarChar(50), action)
            .input('module', sql.VarChar(50), 'Email')
            .input('userName', sql.VarChar(100), 'Sistema')
            .input('details', sql.VarChar(sql.MAX), details)
            .input('timestamp', sql.DateTime, new Date())
            .input('extraData', sql.VarChar(sql.MAX), extraData)
            .query(`INSERT INTO Logs (id, action, module, userName, details, timestamp, extraData) VALUES (@id, @action, @module, @userName, @details, @timestamp, @extraData)`);
    } catch (dbErr) {
        console.error('Error logging email event to database:', dbErr.message);
    }
}

async function sendEmail({ to, subject, html, text, attachments }) {
    try {
        const mailOptions = {
            from: SMTP_FROM,
            to,
            subject,
            text: text || '',
            html: html || text || ''
        };

        if (attachments && Array.isArray(attachments) && attachments.length > 0) {
            mailOptions.attachments = attachments;
        }

        const info = await transporter.sendMail(mailOptions);
        console.log(`✉️ [SMTP] Correo enviado exitosamente a: ${to} (ID: ${info.messageId})`);
        
        await logEmailEvent(true, to, subject);
        return true;
    } catch (err) {
        console.error("❌ Error enviando correo vía SMTP:", err.message);
        await logEmailEvent(false, to, subject, err.message);
        return false;
    }
}

module.exports = {
    sendEmail,
    transporter
};

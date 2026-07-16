const msal = require('@azure/msal-node');
const graph = require('@microsoft/microsoft-graph-client');
require('isomorphic-fetch');

const msalConfig = {
    auth: {
        clientId: process.env.MS_GRAPH_CLIENT_ID || '',
        authority: `https://login.microsoftonline.com/${process.env.MS_GRAPH_TENANT_ID || ''}`,
        clientSecret: process.env.MS_GRAPH_CLIENT_SECRET || '',
    }
};

const cca = new msal.ConfidentialClientApplication(msalConfig);
const mailbox = process.env.MS_GRAPH_SHARED_MAILBOX || 'soporte@simons.cl';

const { getDbPool, sql } = require('../config/db');

async function logEmailEvent(success, to, subject, errorMsg = null) {
    try {
        const pool = await getDbPool();
        const action = success ? 'Envío Email' : 'Error Email';
        const details = success 
            ? `Correo enviado vía Graph a: ${to} (Asunto: ${subject})`
            : `Error enviando correo vía Graph a: ${to} (Asunto: ${subject}) - Error: ${errorMsg}`;
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

async function sendEmail({ to, subject, html, text }) {
    if (!process.env.MS_GRAPH_CLIENT_ID) {
        console.warn('⚠️ Microsoft Graph API no está configurada para el envío de correos.');
        return false;
    }
    try {
        const authResponse = await cca.acquireTokenByClientCredential({
            scopes: ['https://graph.microsoft.com/.default'],
        });
        const client = graph.Client.init({
            authProvider: (done) => done(null, authResponse.accessToken)
        });
        
        const message = {
            subject: subject,
            body: {
                contentType: html ? 'HTML' : 'Text',
                content: html || text
            },
            toRecipients: [{ emailAddress: { address: to } }]
        };
        
        await client.api(`/users/${mailbox}/sendMail`).post({ message: message, saveToSentItems: true });
        console.log(`✉️ Correo enviado vía Graph a: ${to} (Asunto: ${subject})`);
        
        // Log de éxito en la base de datos
        await logEmailEvent(true, to, subject);
        
        return true;
    } catch (err) {
        console.error("❌ Error enviando correo vía Graph:", err);
        
        // Log de error en la base de datos
        await logEmailEvent(false, to, subject, err.message);
        
        return false;
    }
}

module.exports = {
    sendEmail
};

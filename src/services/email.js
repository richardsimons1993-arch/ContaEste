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
        return true;
    } catch (err) {
        console.error("❌ Error enviando correo vía Graph:", err);
        return false;
    }
}

module.exports = {
    sendEmail
};

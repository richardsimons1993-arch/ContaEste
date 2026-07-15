const path = require('path');
// Cargar variables de entorno del directorio raíz
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const { getDbPool, sql } = require('../config/db');
const { sendEmail } = require('../services/email');

async function run() {
    console.log(`[Cron Alerts] Inicio de ejecución a las: ${new Date().toISOString()}`);
    let pool;
    try {
        pool = await getDbPool();
        
        // 1. Obtener usuarios con alertas configuradas
        const usersRes = await pool.request()
            .query("SELECT name, Email, ReceiveOpExpenseAlerts, ReceiveContractAlerts FROM Users WHERE (ReceiveOpExpenseAlerts = 1 OR ReceiveContractAlerts = 1) AND Email IS NOT NULL");
        
        const users = usersRes.recordset;
        if (users.length === 0) {
            console.log("[Cron Alerts] No hay usuarios configurados para recibir alertas por correo.");
            return;
        }

        console.log(`[Cron Alerts] Encontrados ${users.length} usuarios con alertas activas.`);

        const opAlertUsers = users.filter(u => u.ReceiveOpExpenseAlerts === true || u.ReceiveOpExpenseAlerts === 1);
        const contractAlertUsers = users.filter(u => u.ReceiveContractAlerts === true || u.ReceiveContractAlerts === 1);

        const emailPromises = [];

        // 2. Procesar Gastos Operacionales Pendientes si hay usuarios interesados
        if (opAlertUsers.length > 0) {
            const expensesRes = await pool.request()
                .query("SELECT * FROM dbo.[OperationalExpenses] WHERE status = 'active'");
            
            const expenses = expensesRes.recordset;
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const getEffectiveDueDate = (e) => {
                if (!e.nextPaymentDate) return null;
                const nextPaymentDate = e.nextPaymentDate instanceof Date ? e.nextPaymentDate : new Date(e.nextPaymentDate);
                return new Date(nextPaymentDate.getFullYear(), nextPaymentDate.getMonth(), nextPaymentDate.getDate());
            };

            const pendingExpenses = [];
            for (const e of expenses) {
                const effectiveDate = getEffectiveDueDate(e);
                if (!effectiveDate) continue;

                const diffTime = effectiveDate - today;
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                if (diffDays <= 3) {
                    pendingExpenses.push({
                        ...e,
                        effectiveDate,
                        isOverdue: effectiveDate < today,
                        diffDays
                    });
                }
            }

            if (pendingExpenses.length > 0) {
                console.log(`[Cron Alerts] Encontrados ${pendingExpenses.length} gastos pendientes/vencidos. Enviando a ${opAlertUsers.length} usuarios.`);
                
                for (const user of opAlertUsers) {
                    const expensesRows = pendingExpenses.map(e => {
                        const formattedAmount = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(e.amount || 0);
                        const statusText = e.isOverdue ? '<span style="color: #cf1322; font-weight: bold;">(VENCIDO)</span>' : '<span style="color: #d46b08; font-weight: bold;">(POR VENCER)</span>';
                        const formattedDate = e.effectiveDate.toLocaleDateString('es-CL');
                        const frequencyMap = {
                            'monthly': 'Mensual',
                            'quarterly': 'Trimestral',
                            'semiannually': 'Semestral',
                            'yearly': 'Anual'
                        };
                        const freqText = frequencyMap[e.frequency] || e.frequency || 'N/A';
                        return `
                            <tr style="border-bottom: 1px solid #e0e0e0;">
                                <td style="padding: 12px; font-size: 0.9rem; color: #333;">
                                    <strong>${e.name}</strong><br>
                                    <small style="color: #777;">${e.description || 'Sin descripción'}</small>
                                </td>
                                <td style="padding: 12px; font-size: 0.9rem; color: #555;">${freqText}</td>
                                <td style="padding: 12px; font-size: 0.9rem; color: #555;">${formattedDate} ${statusText}</td>
                                <td style="padding: 12px; font-size: 0.9rem; text-align: right; font-weight: bold; color: #333;">${formattedAmount}</td>
                            </tr>
                        `;
                    }).join('');

                    const emailSubject = `📋 Resumen de Gastos Operacionales Pendientes`;
                    const emailHtml = `
                        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
                            <div style="text-align: center; border-bottom: 3px solid #1a73e8; padding-bottom: 16px; margin-bottom: 24px;">
                                <h2 style="color: #1a73e8; margin: 0; font-size: 1.5rem; font-weight: 700;">Gastos Operacionales</h2>
                                <p style="margin: 4px 0 0 0; color: #718096; font-size: 0.85rem;">Reporte diario de vencimientos preventivos</p>
                            </div>
                            <p style="font-size: 1rem; color: #2d3748; line-height: 1.5; margin-bottom: 16px;">Hola <strong>${user.name}</strong>,</p>
                            <p style="font-size: 0.95rem; color: #4a5568; line-height: 1.5; margin-bottom: 20px;">Te informamos los gastos operacionales que requieren pago (vencidos o a vencer dentro de los próximos 3 días):</p>
                            
                            <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
                                <thead>
                                    <tr style="background-color: #f7fafc; border-bottom: 2px solid #edf2f7; text-align: left;">
                                        <th style="padding: 12px; font-size: 0.85rem; font-weight: bold; color: #4a5568; text-transform: uppercase;">Detalle</th>
                                        <th style="padding: 12px; font-size: 0.85rem; font-weight: bold; color: #4a5568; text-transform: uppercase;">Frecuencia</th>
                                        <th style="padding: 12px; font-size: 0.85rem; font-weight: bold; color: #4a5568; text-transform: uppercase;">Vencimiento</th>
                                        <th style="padding: 12px; font-size: 0.85rem; font-weight: bold; color: #4a5568; text-transform: uppercase; text-align: right;">Monto</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${expensesRows}
                                </tbody>
                            </table>
                            
                            <div style="background-color: #ebf8ff; border-left: 4px solid #3182ce; padding: 12px 16px; border-radius: 4px; margin-bottom: 24px;">
                                <p style="margin: 0; font-size: 0.85rem; color: #2b6cb0; line-height: 1.4;">
                                    <strong>💡 Nota:</strong> Puedes registrar el pago de estos gastos desde el módulo "Gastos Op." en la aplicación web para actualizar la fecha del próximo vencimiento de forma automática.
                                </p>
                            </div>
                            
                            <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 24px 0;">
                            <p style="font-size: 0.75rem; color: #a0aec0; text-align: center; margin: 0;">Este es un mensaje automático generado por ContaEste ERP.</p>
                        </div>
                    `;

                    emailPromises.push(sendEmail({ to: user.Email, subject: emailSubject, html: emailHtml }));
                }
            } else {
                console.log("[Cron Alerts] No hay gastos operacionales vencidos o por vencer en <= 3 días.");
            }
        }

        // 3. Procesar Contratos Pendientes de Facturación si hay usuarios interesados
        if (contractAlertUsers.length > 0) {
            const now = new Date();
            const currentYear = now.getFullYear();
            const currentMonth = String(now.getMonth() + 1).padStart(2, '0');
            const currentDay = now.getDate();
            const currentPeriod = `${currentYear}-${currentMonth}`;
            const currentDateStr = `${currentYear}-${currentMonth}-${String(currentDay).padStart(2, '0')}`;

            const pendingContractsRes = await pool.request()
                .input('currentDate', sql.Date, currentDateStr)
                .input('currentDay', sql.Int, currentDay)
                .input('currentPeriod', sql.VarChar, currentPeriod)
                .query(`
                    SELECT c.*, cl.name as clientName, cl.nombreFantasia as clientFantasyName
                    FROM Contracts c
                    LEFT JOIN Clients cl ON c.clientId = cl.id
                    WHERE c.startDate <= @currentDate 
                      AND (c.endDate IS NULL OR c.endDate >= @currentDate)
                      AND c.billingDay <= @currentDay
                      AND (c.lastInvoicedPeriod IS NULL OR c.lastInvoicedPeriod != @currentPeriod)
                `);
            
            const pendingContracts = pendingContractsRes.recordset;

            if (pendingContracts.length > 0) {
                console.log(`[Cron Alerts] Encontrados ${pendingContracts.length} contratos pendientes de facturar. Enviando a ${contractAlertUsers.length} usuarios.`);

                for (const user of contractAlertUsers) {
                    const contractsRows = pendingContracts.map(c => {
                        const clientName = c.clientFantasyName || c.clientName || 'Cliente Desconocido';
                        const formattedAmount = c.currency === 'UF' ? `${c.amount} UF` : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(c.amount || 0);
                        return `
                            <tr style="border-bottom: 1px solid #e0e0e0;">
                                <td style="padding: 12px; font-size: 0.9rem; color: #333;"><strong>${clientName}</strong></td>
                                <td style="padding: 12px; font-size: 0.9rem; color: #555;">Día ${c.billingDay} de cada mes</td>
                                <td style="padding: 12px; font-size: 0.9rem; color: #555;">${c.frequency || 'Mensual'}</td>
                                <td style="padding: 12px; font-size: 0.9rem; text-align: right; font-weight: bold; color: #333;">${formattedAmount}</td>
                            </tr>
                        `;
                    }).join('');

                    const emailSubject = `📋 Resumen de Contratos Pendientes de Facturación`;
                    const emailHtml = `
                        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
                            <div style="text-align: center; border-bottom: 3px solid #e28743; padding-bottom: 16px; margin-bottom: 24px;">
                                <h2 style="color: #e28743; margin: 0; font-size: 1.5rem; font-weight: 700;">Contratos Pendientes</h2>
                                <p style="margin: 4px 0 0 0; color: #718096; font-size: 0.85rem;">Periodo de Facturación: ${currentPeriod}</p>
                            </div>
                            <p style="font-size: 1rem; color: #2d3748; line-height: 1.5; margin-bottom: 16px;">Hola <strong>${user.name}</strong>,</p>
                            <p style="font-size: 0.95rem; color: #4a5568; line-height: 1.5; margin-bottom: 20px;">Te informamos los contratos activos que ya alcanzaron su día de cobro pero que aún no han sido facturados para el periodo actual:</p>
                            
                            <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
                                <thead>
                                    <tr style="background-color: #f7fafc; border-bottom: 2px solid #edf2f7; text-align: left;">
                                        <th style="padding: 12px; font-size: 0.85rem; font-weight: bold; color: #4a5568; text-transform: uppercase;">Cliente</th>
                                        <th style="padding: 12px; font-size: 0.85rem; font-weight: bold; color: #4a5568; text-transform: uppercase;">Día Cobro</th>
                                        <th style="padding: 12px; font-size: 0.85rem; font-weight: bold; color: #4a5568; text-transform: uppercase;">Frecuencia</th>
                                        <th style="padding: 12px; font-size: 0.85rem; font-weight: bold; color: #4a5568; text-transform: uppercase; text-align: right;">Monto Neto</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${contractsRows}
                                </tbody>
                            </table>
                            
                            <div style="background-color: #fffaf0; border-left: 4px solid #dd6b20; padding: 12px 16px; border-radius: 4px; margin-bottom: 24px;">
                                <p style="margin: 0; font-size: 0.85rem; color: #dd6b20; line-height: 1.4;">
                                    <strong>💡 Nota:</strong> Puedes procesar y generar los cobros para estos contratos desde el módulo de "Contratos" en la sección de notificaciones de la app.
                                </p>
                            </div>
                            
                            <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 24px 0;">
                            <p style="font-size: 0.75rem; color: #a0aec0; text-align: center; margin: 0;">Este es un mensaje automático generado por ContaEste ERP.</p>
                        </div>
                    `;

                    emailPromises.push(sendEmail({ to: user.Email, subject: emailSubject, html: emailHtml }));
                }
            } else {
                console.log("[Cron Alerts] No hay contratos activos pendientes de facturar en el mes corriente.");
            }
        }

        // 4. Esperar que todos los correos se envíen
        if (emailPromises.length > 0) {
            console.log(`[Cron Alerts] Enviando ${emailPromises.length} correos en total...`);
            const results = await Promise.all(emailPromises);
            const sentCount = results.filter(r => r === true).length;
            console.log(`[Cron Alerts] Finalizado. Envíos exitosos: ${sentCount}/${results.length}`);
        } else {
            console.log("[Cron Alerts] No se generaron correos para enviar el día de hoy.");
        }

    } catch (err) {
        console.error("[Cron Alerts] Error fatal ejecutando las alertas de Cron:", err);
    } finally {
        if (pool) {
            try {
                await pool.close();
                console.log("[Cron Alerts] Conexión a la base de datos cerrada.");
            } catch (closeErr) {
                console.error("[Cron Alerts] Error cerrando el pool de conexiones:", closeErr);
            }
        }
        console.log("[Cron Alerts] Fin de la ejecución.");
    }
}

// Ejecutar proceso
run();

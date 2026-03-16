const axios = require('axios');
const sql = require('mssql/msnodesqlv8');

const dbConfig = {
    connectionString: 'Driver={ODBC Driver 18 for SQL Server};Server=localhost\\SIMONS;Database=ContabilidadDB;UID=sa;PWD=S0p0rt3!!2025;Encrypt=yes;TrustServerCertificate=yes;'
};

async function fetchUF() {
    try {
        const response = await axios.get('https://mindicador.cl/api/uf', { timeout: 5000 });
        if (response.data && response.data.serie && response.data.serie.length > 0) {
            return response.data.serie[0].valor;
        }
    } catch (error) {
        console.error('Error fetching UF:', error.message);
    }
    return null;
}

async function test() {
    try {
        const pool = await sql.connect(dbConfig);
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = String(now.getMonth() + 1).padStart(2, '0');
        const currentDay = now.getDate();
        const currentPeriod = `${currentYear}-${currentMonth}`;
        const currentDateStr = `${currentYear}-${currentMonth}-${String(currentDay).padStart(2, '0')}`;

        const query = `
            SELECT * FROM Contracts 
            WHERE startDate <= @currentDate 
              AND endDate >= @currentDate
              AND billingDay <= @currentDay
              AND (lastInvoicedPeriod IS NULL OR lastInvoicedPeriod != @currentPeriod)
        `;
        const result = await pool.request()
            .input('currentDate', sql.Date, currentDateStr)
            .input('currentDay', sql.Int, currentDay)
            .input('currentPeriod', sql.VarChar, currentPeriod)
            .query(query);

        let contracts = result.recordset;
        console.log("Contracts found:", JSON.stringify(contracts));

        if (contracts.some(c => c.currency === 'UF')) {
            console.log("UF Contract detected");
            const uf = await fetchUF();
            console.log("UF value:", uf);
            if (uf) {
                contracts = contracts.map(c => {
                    if (c.currency === 'UF') {
                        return { ...c, amountCLP: Math.round(c.amount * uf) };
                    }
                    return c;
                });
            }
        }
        console.log("Final response:", JSON.stringify(contracts));
    } catch (err) {
        console.error(err);
    } finally {
        await sql.close();
    }
}

test();

const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { getDbPool, sql, getApi, deleteApi } = require('../config/db');

const BCRYPT_ROUNDS = 10;

// ==========================================
// USERS ROUTES
// ==========================================
router.get('/users', async (req, res) => {
    try {
        const pool = await getDbPool();
        const result = await pool.request().query('SELECT id, username, role, name, modules, Email, ReceiveOpExpenseAlerts, ReceiveContractAlerts FROM Users');
        const users = result.recordset.map(u => ({
            ...u,
            modules: u.modules ? JSON.parse(u.modules) : []
        }));
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/users/:id', (req, res) => deleteApi(req, res, 'Users'));

router.post('/users', async (req, res) => {
    try {
        const u = req.body;
        const pool = await getDbPool();
        const check = await pool.request().input('id', sql.VarChar(50), u.id).query('SELECT id, password FROM Users WHERE id = @id');

        let hashedPassword;
        if (u.password && u.password.trim() !== '') {
            hashedPassword = await bcrypt.hash(u.password, BCRYPT_ROUNDS);
        } else if (check.recordset.length > 0) {
            hashedPassword = check.recordset[0].password;
        } else {
            hashedPassword = await bcrypt.hash('SSO_MANAGED_' + Date.now(), BCRYPT_ROUNDS);
        }

        const modulesJson = JSON.stringify(u.modules || []);
        
        const receiveOpExpenseAlerts = u.receiveOpExpenseAlerts ? 1 : 0;
        const receiveContractAlerts = u.receiveContractAlerts ? 1 : 0;

        if (check.recordset.length > 0) {
            await pool.request()
                .input('id', sql.VarChar(50), u.id)
                .input('username', sql.VarChar(50), u.username)
                .input('password', sql.VarChar(100), hashedPassword)
                .input('role', sql.VarChar(50), u.role)
                .input('name', sql.VarChar(100), u.name)
                .input('Email', sql.NVarChar(255), u.email || null)
                .input('modules', sql.VarChar(sql.MAX), modulesJson)
                .input('ReceiveOpExpenseAlerts', sql.Bit, receiveOpExpenseAlerts)
                .input('ReceiveContractAlerts', sql.Bit, receiveContractAlerts)
                .query(`UPDATE Users SET username=@username, password=@password, role=@role, name=@name, Email=@Email, modules=@modules, ReceiveOpExpenseAlerts=@ReceiveOpExpenseAlerts, ReceiveContractAlerts=@ReceiveContractAlerts WHERE id=@id`);
        } else {
            await pool.request()
                .input('id', sql.VarChar(50), u.id)
                .input('username', sql.VarChar(50), u.username)
                .input('password', sql.VarChar(100), hashedPassword)
                .input('role', sql.VarChar(50), u.role)
                .input('name', sql.VarChar(100), u.name)
                .input('Email', sql.NVarChar(255), u.email || null)
                .input('modules', sql.VarChar(sql.MAX), modulesJson)
                .input('ReceiveOpExpenseAlerts', sql.Bit, receiveOpExpenseAlerts)
                .input('ReceiveContractAlerts', sql.Bit, receiveContractAlerts)
                .query(`INSERT INTO Users (id, username, password, role, name, Email, modules, ReceiveOpExpenseAlerts, ReceiveContractAlerts) VALUES (@id, @username, @password, @role, @name, @Email, @modules, @ReceiveOpExpenseAlerts, @ReceiveContractAlerts)`);
        }
        res.json({ 
            id: u.id, 
            username: u.username, 
            role: u.role, 
            name: u.name, 
            email: u.email, 
            modules: u.modules || [],
            ReceiveOpExpenseAlerts: receiveOpExpenseAlerts,
            ReceiveContractAlerts: receiveContractAlerts
        });
    } catch (err) {
        console.error('Error in POST /api/users:', err);
        res.status(500).json({ error: err.message });
    }
});

router.post('/users/batch', async (req, res) => {
    try {
        const usersArray = req.body;
        const pool = await getDbPool();
        await pool.request().query('DELETE FROM Users');
        for (let u of usersArray) {
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

// ==========================================
// APP-LOCATIONS ROUTES
// ==========================================
router.get('/app-locations', (req, res) => getApi(req, res, 'AppLocations'));
router.delete('/app-locations/:id', (req, res) => deleteApi(req, res, 'AppLocations'));

router.post('/app-locations', async (req, res) => {
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

module.exports = router;

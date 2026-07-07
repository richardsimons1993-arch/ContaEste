const express = require('express');
const router = express.Router();
const { getDbPool, sql, deleteApi } = require('../config/db');

// GET /api/clients
router.get('/', async (req, res) => {
    try {
        const pool = await getDbPool();
        const result = await pool.request().query('SELECT * FROM Clients');
        const clients = result.recordset.map(c => ({
            id: c.id,
            razonSocial: c.name,
            nombreFantasia: c.nombreFantasia,
            rut: c.rut,
            encargado: c.encargado,
            telefono: c.phone,
            correo: c.email,
            direccion: c.address
        }));
        res.json(clients);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/clients/:id
router.delete('/:id', (req, res) => deleteApi(req, res, 'Clients'));

// POST /api/clients
router.post('/', async (req, res) => {
    try {
        const c = req.body;
        const pool = await getDbPool();
        const clientId = c.id;

        const check = await pool.request().input('id', sql.VarChar(50), clientId).query('SELECT id FROM Clients WHERE id = @id');
        const clientName = c.razonSocial || c.name || 'Sin Nombre';

        if (check.recordset.length > 0) {
            await pool.request()
                .input('id', sql.VarChar(50), clientId)
                .input('name', sql.VarChar(255), clientName)
                .input('nombreFantasia', sql.VarChar(255), c.nombreFantasia || null)
                .input('rut', sql.VarChar(50), c.rut || null)
                .input('encargado', sql.VarChar(255), c.encargado || null)
                .input('phone', sql.VarChar(50), c.telefono || null)
                .input('email', sql.VarChar(255), c.correo || null)
                .input('address', sql.VarChar(255), c.direccion || null)
                .query(`UPDATE Clients SET name=@name, nombreFantasia=@nombreFantasia, rut=@rut, encargado=@encargado, phone=@phone, email=@email, address=@address WHERE id=@id`);
        } else {
            await pool.request()
                .input('id', sql.VarChar(50), clientId)
                .input('name', sql.VarChar(255), clientName)
                .input('nombreFantasia', sql.VarChar(255), c.nombreFantasia || null)
                .input('rut', sql.VarChar(50), c.rut || null)
                .input('encargado', sql.VarChar(255), c.encargado || null)
                .input('phone', sql.VarChar(50), c.telefono || null)
                .input('email', sql.VarChar(255), c.correo || null)
                .input('address', sql.VarChar(255), c.direccion || null)
                .query(`INSERT INTO Clients (id, name, nombreFantasia, rut, encargado, phone, email, address) VALUES (@id, @name, @nombreFantasia, @rut, @encargado, @phone, @email, @address)`);
        }
        res.json({ success: true, id: clientId });
    } catch (err) {
        console.error('Error in POST /api/clients:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;

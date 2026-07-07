const express = require('express');
const router = express.Router();
const { getDbPool, sql, getApi, deleteApi } = require('../config/db');

// GET /api/inventory
router.get('/', (req, res) => getApi(req, res, 'Inventory'));

// DELETE /api/inventory/:id
router.delete('/:id', (req, res) => deleteApi(req, res, 'Inventory'));

// POST /api/inventory (Insert/Update)
router.post('/', async (req, res) => {
    try {
        const i = req.body;
        const pool = await getDbPool();
        const check = await pool.request().input('id', sql.VarChar(50), i.id).query('SELECT id FROM Inventory WHERE id = @id');

        if (check.recordset.length > 0) {
            await pool.request()
                .input('id', sql.VarChar(50), i.id)
                .input('product', sql.VarChar(255), i.product)
                .input('quantity', sql.Decimal(18, 2), i.quantity)
                .input('unitPrice', sql.Decimal(18, 2), i.unitPrice)
                .input('location', sql.VarChar(100), i.location)
                .query(`UPDATE Inventory SET product=@product, quantity=@quantity, unitPrice=@unitPrice, location=@location WHERE id=@id`);
        } else {
            await pool.request()
                .input('id', sql.VarChar(50), i.id)
                .input('product', sql.VarChar(255), i.product)
                .input('quantity', sql.Decimal(18, 2), i.quantity)
                .input('unitPrice', sql.Decimal(18, 2), i.unitPrice)
                .input('location', sql.VarChar(100), i.location)
                .query(`INSERT INTO Inventory (id, product, quantity, unitPrice, location) VALUES (@id, @product, @quantity, @unitPrice, @location)`);
        }
        res.json(i);
    } catch (err) {
        console.error('Error in POST /api/inventory:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/inventory/history
router.get('/history', (req, res) => getApi(req, res, 'InventoryHistory ORDER BY timestamp DESC'));

// POST /api/inventory/history
router.post('/history', async (req, res) => {
    try {
        const h = req.body;
        const pool = await getDbPool();
        await pool.request()
            .input('id', sql.VarChar(50), h.id || Date.now().toString())
            .input('productId', sql.VarChar(50), h.productId)
            .input('productName', sql.VarChar(255), h.productName)
            .input('type', sql.VarChar(50), h.type)
            .input('origin', sql.VarChar(255), h.origin || null)
            .input('destination', sql.VarChar(255), h.destination || null)
            .input('quantityChange', sql.Decimal(18, 2), h.quantityChange || 0)
            .input('userId', sql.VarChar(50), h.userId || null)
            .input('userName', sql.VarChar(100), h.userName || null)
            .query(`INSERT INTO InventoryHistory (id, productId, productName, type, origin, destination, quantityChange, userId, userName) 
                    VALUES (@id, @productId, @productName, @type, @origin, @destination, @quantityChange, @userId, @userName)`);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;

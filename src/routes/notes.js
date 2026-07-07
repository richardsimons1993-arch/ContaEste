const express = require('express');
const router = express.Router();
const { getDbPool, sql } = require('../config/db');

// Función para eliminar notas de la papelera con más de 30 días
async function deleteExpiredNotes() {
    try {
        const pool = await getDbPool();
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const result = await pool.request()
            .input('thirtyDaysAgo', sql.DateTime, thirtyDaysAgo)
            .query('DELETE FROM Notes WHERE deleted = 1 AND deletedAt < @thirtyDaysAgo');
        
        if (result.rowsAffected[0] > 0) {
            console.log(`🧹 Limpieza: ${result.rowsAffected[0]} notas antiguas eliminadas permanentemente.`);
            await pool.request()
                .input('id', sql.VarChar(50), Date.now().toString() + Math.floor(Math.random() * 1000).toString())
                .input('action', sql.VarChar(50), 'Limpieza')
                .input('module', sql.VarChar(50), 'notes')
                .input('userName', sql.VarChar(100), 'Sistema')
                .input('details', sql.VarChar(sql.MAX), `${result.rowsAffected[0]} notas antiguas en la papelera eliminadas permanentemente`)
                .input('timestamp', sql.DateTime, new Date())
                .query(`INSERT INTO Logs (id, action, module, userName, details, timestamp) VALUES (@id, @action, @module, @userName, @details, @timestamp)`);
        }
    } catch (err) {
        console.error('⚠️ Error en limpieza de notas:', err.message);
    }
}

// GET /api/notes/:userId
router.get('/:userId', async (req, res) => {
    try {
        const pool = await getDbPool();
        const result = await pool.request()
            .input('userId', sql.VarChar, req.params.userId)
            .query('SELECT * FROM Notes WHERE userId = @userId ORDER BY pinned DESC, lastModified DESC');
        
        const notes = result.recordset.map(n => ({
            ...n,
            pinned: n.pinned === true || n.pinned === 1,
            archived: n.archived === true || n.archived === 1,
            deleted: n.deleted === true || n.deleted === 1
        }));
        res.json(notes);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/notes
router.post('/', async (req, res) => {
    try {
        const n = req.body;
        const pool = await getDbPool();
        
        const content = typeof n.content === 'object' ? JSON.stringify(n.content) : n.content;
        const lastModified = n.lastModified || new Date().toISOString();

        console.log(`📝 Recibida nota ID: ${n.id} (Archivada: ${n.archived}, Eliminada: ${n.deleted})`);

        const check = await pool.request()
            .input('id', sql.VarChar(50), n.id)
            .query('SELECT id FROM Notes WHERE id = @id');

        if (check.recordset.length > 0) {
            await pool.request()
                .input('id', sql.VarChar(50), n.id)
                .input('userId', sql.VarChar(50), n.userId)
                .input('title', sql.VarChar(255), n.title || '')
                .input('content', sql.VarChar(sql.MAX), content)
                .input('type', sql.VarChar(50), n.type || 'text')
                .input('pinned', sql.Bit, n.pinned ? 1 : 0)
                .input('archived', sql.Bit, n.archived ? 1 : 0)
                .input('deleted', sql.Bit, n.deleted ? 1 : 0)
                .input('deletedAt', sql.DateTime, n.deletedAt ? new Date(n.deletedAt) : null)
                .input('lastModified', sql.DateTime, new Date(lastModified))
                .query(`UPDATE Notes SET userId=@userId, title=@title, content=@content, type=@type, pinned=@pinned, archived=@archived, deleted=@deleted, deletedAt=@deletedAt, lastModified=@lastModified WHERE id=@id`);
            console.log(`✅ Nota ${n.id} actualizada.`);
        } else {
            await pool.request()
                .input('id', sql.VarChar(50), n.id)
                .input('userId', sql.VarChar(50), n.userId)
                .input('title', sql.VarChar(255), n.title || '')
                .input('content', sql.VarChar(sql.MAX), content)
                .input('type', sql.VarChar(50), n.type || 'text')
                .input('pinned', sql.Bit, n.pinned ? 1 : 0)
                .input('archived', sql.Bit, n.archived ? 1 : 0)
                .input('deleted', sql.Bit, n.deleted ? 1 : 0)
                .input('deletedAt', sql.DateTime, n.deletedAt ? new Date(n.deletedAt) : null)
                .input('lastModified', sql.DateTime, new Date(lastModified))
                .query(`INSERT INTO Notes (id, userId, title, content, type, pinned, archived, deleted, deletedAt, lastModified) VALUES (@id, @userId, @title, @content, @type, @pinned, @archived, @deleted, @deletedAt, @lastModified)`);
            console.log(`✅ Nota ${n.id} creada.`);
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/notes/:id
router.delete('/:id', async (req, res) => {
    try {
        const pool = await getDbPool();
        const noteId = req.params.id;

        const check = await pool.request()
            .input('id', sql.VarChar(50), noteId)
            .query('SELECT deleted FROM Notes WHERE id = @id');

        if (check.recordset.length > 0 && check.recordset[0].deleted) {
            await pool.request()
                .input('id', sql.VarChar(50), noteId)
                .query('DELETE FROM Notes WHERE id = @id');
            res.json({ success: true, permanent: true });
        } else {
            await pool.request()
                .input('id', sql.VarChar(50), noteId)
                .input('deletedAt', sql.DateTime, new Date())
                .query('UPDATE Notes SET deleted = 1, pinned = 0, deletedAt = @deletedAt WHERE id = @id');
            res.json({ success: true, permanent: false });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = {
    router,
    deleteExpiredNotes
};

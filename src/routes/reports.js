const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { getDbPool, sql } = require('../config/db');

const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
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

// GET /api/reports
router.get('/', async (req, res) => {
    try {
        const pool = await getDbPool();
        const result = await pool.request().query('SELECT * FROM Reports ORDER BY createdAt DESC');
        console.log(`📦 Historial: Sirviendo ${result.recordset.length} informes.`);
        res.json(result.recordset);
    } catch (err) {
        console.error('Error al obtener informes:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/reports/next-id/:prefixOrId/:year
router.get('/next-id/:prefixOrId/:year', async (req, res) => {
    try {
        const year = parseInt(req.params.year);
        let prefix = req.params.prefixOrId;
        
        if (prefix.length > 5) {
            const pool = await getDbPool();
            const clientRes = await pool.request()
                .input('id', sql.VarChar(50), prefix)
                .query('SELECT name as razonSocial, nombreFantasia FROM Clients WHERE id = @id');
            
            if (clientRes.recordset.length > 0) {
                const c = clientRes.recordset[0];
                const nameStr = c.nombreFantasia || c.razonSocial || 'XXX';
                prefix = nameStr.replace(/[^A-Za-z\u00C0-\u017F]/g, '').substring(0, 3).toUpperCase().padEnd(3, 'X');
            } else {
                prefix = prefix.substring(0, 3).toUpperCase();
            }
        }

        const pool = await getDbPool();
        const pattern = 'INF-' + prefix + '-' + year + '-%';
        const result = await pool.request()
            .input('year', sql.Int, year)
            .input('pattern', sql.VarChar(50), pattern)
            .query("SELECT ISNULL(MAX(correlative), 0) + 1 AS nextId FROM Reports WHERE year = @year AND id LIKE @pattern");
        
        res.json({ nextId: result.recordset[0].nextId });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/reports/next-version/:id
router.get('/next-version/:id', async (req, res) => {
    try {
        const pool = await getDbPool();
        const result = await pool.request()
            .input('id', sql.VarChar(50), req.params.id)
            .query('SELECT ISNULL(MAX(version), 0) + 1 AS nextVersion FROM Reports WHERE id = @id');
        res.json({ nextVersion: result.recordset[0].nextVersion });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/reports
router.post('/', async (req, res) => {
    try {
        const r = req.body;
        const pool = await getDbPool();
        await pool.request()
            .input('id', sql.VarChar(50), r.id)
            .input('correlative', sql.Int, r.correlative)
            .input('year', sql.Int, r.year)
            .input('version', sql.Int, r.version || 1)
            .input('clientId', sql.VarChar(50), r.clientId)
            .input('clientName', sql.VarChar(255), r.clientName)
            .input('projectName', sql.VarChar(255), r.projectName || '')
            .input('generalData', sql.VarChar(sql.MAX), r.generalData || '')
            .input('scope', sql.VarChar(sql.MAX), r.scope || '')
            .input('materials', sql.VarChar(sql.MAX), JSON.stringify(r.materials || []))
            .input('results', sql.VarChar(sql.MAX), r.results || '')
            .input('conclusions', sql.VarChar(sql.MAX), r.conclusions || '')
            .input('images', sql.VarChar(sql.MAX), JSON.stringify(r.images || []))
            .query(`
                MERGE Reports AS target
                USING (SELECT @id AS id, @version AS version) AS source
                ON (target.id = source.id AND target.version = source.version)
                WHEN MATCHED THEN
                    UPDATE SET 
                        correlative = @correlative, year = @year, clientId = @clientId,
                        clientName = @clientName, projectName = @projectName,
                        generalData = @generalData, scope = @scope,
                        materials = @materials, results = @results, conclusions = @conclusions,
                        images = @images
                WHEN NOT MATCHED THEN
                    INSERT (id, correlative, year, version, clientId, clientName, projectName, generalData, scope, materials, results, conclusions, images, createdAt)
                    VALUES (@id, @correlative, @year, @version, @clientId, @clientName, @projectName, @generalData, @scope, @materials, @results, @conclusions, @images, GETDATE());
            `);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/reports/:id/:version
router.delete('/:id/:version', async (req, res) => {
    try {
        const pool = await getDbPool();
        await pool.request()
            .input('id', sql.VarChar(50), req.params.id)
            .input('version', sql.Int, req.params.version)
            .query('DELETE FROM Reports WHERE id = @id AND version = @version');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/reports/save-pdf
router.post('/save-pdf', async (req, res) => {
    try {
        const { clientName, year, reportId, projectName, pdfBase64 } = req.body;
        const base64Data = pdfBase64.includes('base64,') ? pdfBase64.split('base64,')[1] : pdfBase64;
        const safeProjectName = projectName ? `_${projectName.replace(/[^a-zA-Z0-9 -]/g, '_')}` : '';
        const fileName = `Informe_${reportId}${safeProjectName}_${clientName.replace(/[^a-zA-Z0-9 -]/g, '')}.pdf`;

        const isWindows = process.platform === 'win32';

        if (isWindows) {
            const baseDriveDir = path.join('C:', 'Users', 'Richard', 'OneDrive - SIMONS SPA', 'Simons SPA', 'Clientes', 'Informes APP');
            const yearDir = path.join(baseDriveDir, year.toString());
            const clientDir = path.join(yearDir, clientName);
            
            if (!fs.existsSync(baseDriveDir)) fs.mkdirSync(baseDriveDir, { recursive: true });
            if (!fs.existsSync(yearDir)) fs.mkdirSync(yearDir, { recursive: true });
            if (!fs.existsSync(clientDir)) fs.mkdirSync(clientDir, { recursive: true });

            const filePath = path.join(clientDir, fileName);
            fs.writeFileSync(filePath, base64Data, 'base64');
            
            console.log(`✅ PDF informe guardado localmente (Windows): ${filePath}`);
            res.json({ success: true, filePath });
        } else {
            const localTempDir = path.join(process.cwd(), 'temp_pdfs');
            if (!fs.existsSync(localTempDir)) {
                fs.mkdirSync(localTempDir, { recursive: true });
            }
            const localFilePath = path.join(localTempDir, fileName);
            fs.writeFileSync(localFilePath, base64Data, 'base64');
            console.log(`✅ PDF informe guardado localmente temporal: ${localFilePath}`);

            const { execFile } = require('child_process');
            const remoteDestDir = `onedrive_backup:Simons SPA/Clientes/Informes APP/${year}/${clientName}`;
            
            const rcloneArgs = ['copy', localFilePath, remoteDestDir];
            const rcloneConfigPath = '/home/administrador/.config/rclone/rclone.conf';
            if (fs.existsSync(rcloneConfigPath)) {
                rcloneArgs.push('--config', rcloneConfigPath);
            }
            
            execFile('/usr/bin/rclone', rcloneArgs, (error, stdout, stderr) => {
                try {
                    if (fs.existsSync(localFilePath)) {
                        fs.unlinkSync(localFilePath);
                    }
                } catch (unlinkErr) {
                    console.error('Error al eliminar PDF temporal de informe:', unlinkErr);
                }

                if (error) {
                    console.error('Error al subir PDF de informe con rclone:', error);
                    return res.status(500).json({ error: `Error de subida de documento: ${error.message}` });
                }
                
                console.log(`✅ PDF informe subido con éxito a OneDrive (${remoteDestDir}/${fileName})`);
                res.json({ success: true, filePath: `${remoteDestDir}/${fileName}` });
            });
        }
    } catch (err) {
        console.error('Error al guardar PDF de informe:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/reports/upload-image
router.post('/upload-image', upload.single('image'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No se subió ninguna imagen' });
    const imageUrl = `/uploads/${req.file.filename}`;
    res.json({ url: imageUrl });
});

module.exports = router;

-- Agregar columnas para Archivados y Papelera en la Tabla Notes
-- Versión 22: 06-04-2026

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Notes') AND name = 'archived')
BEGIN
    ALTER TABLE Notes ADD archived BIT DEFAULT 0;
END
GO

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Notes') AND name = 'deleted')
BEGIN
    ALTER TABLE Notes ADD deleted BIT DEFAULT 0;
END
GO

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Notes') AND name = 'deletedAt')
BEGIN
    ALTER TABLE Notes ADD deletedAt DATETIME NULL;
END
GO

-- Actualizar valores existentes (por si acaso)
UPDATE Notes SET archived = 0 WHERE archived IS NULL;
UPDATE Notes SET deleted = 0 WHERE deleted IS NULL;
GO

PRINT '✅ Tabla Notes actualizada exitosamente para soportar Archivados y Papelera.';

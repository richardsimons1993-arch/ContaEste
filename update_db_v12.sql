USE ContabilidadDB;
GO

-- Agregar columna projectName a Projects si no existe
IF NOT EXISTS (SELECT * FROM sys.columns WHERE name = 'projectName' AND object_id = OBJECT_ID('Projects'))
BEGIN
    ALTER TABLE Projects ADD projectName VARCHAR(255) NULL;
END
GO

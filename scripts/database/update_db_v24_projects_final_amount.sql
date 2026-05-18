USE ContabilidadDB;
GO

-- Agregar columna finalAmount a la tabla Projects si no existe
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Projects') AND name = 'finalAmount')
BEGIN
    ALTER TABLE Projects ADD finalAmount DECIMAL(18,2) NULL;
    PRINT 'Columna finalAmount agregada a Projects';
END
GO

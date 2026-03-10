USE ContabilidadDB;
GO

-- Agregar columna supplierId a Transactions si no existe
IF NOT EXISTS (SELECT * FROM sys.columns WHERE name = 'supplierId' AND object_id = OBJECT_ID('Transactions'))
BEGIN
    ALTER TABLE Transactions ADD supplierId VARCHAR(50) NULL;
END
GO

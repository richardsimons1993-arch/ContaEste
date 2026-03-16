USE ContabilidadDB;
GO

-- 1. Agregar columna de moneda a Contracts
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Contracts') AND name = 'currency')
BEGIN
    ALTER TABLE Contracts ADD currency VARCHAR(10) DEFAULT 'CLP';
END
GO

-- 2. Asegurar que los contratos existentes tengan CLP
UPDATE Contracts SET currency = 'CLP' WHERE currency IS NULL;
GO

-- 3. Agregar columnas de registro de conversión a ContractHistory
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('ContractHistory') AND name = 'ufValue')
BEGIN
    ALTER TABLE ContractHistory ADD ufValue DECIMAL(18,4), amountCLP DECIMAL(18,2);
END
GO

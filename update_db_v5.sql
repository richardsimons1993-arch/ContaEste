USE ContabilidadDB;
GO

-- Tabla Suppliers (Proveedores)
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Suppliers' and xtype='U')
BEGIN
    CREATE TABLE Suppliers (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        rut VARCHAR(50),
        encargado VARCHAR(255),
        phone VARCHAR(50),
        email VARCHAR(255),
        address VARCHAR(255)
    );
END
GO

-- Agregar columna conceptId a Debts si no existe
IF NOT EXISTS (SELECT * FROM sys.columns WHERE name = 'conceptId' AND object_id = OBJECT_ID('Debts'))
BEGIN
    ALTER TABLE Debts ADD conceptId VARCHAR(50) NULL;
END
GO

-- Agregar columna supplierId a Debts si no existe
IF NOT EXISTS (SELECT * FROM sys.columns WHERE name = 'supplierId' AND object_id = OBJECT_ID('Debts'))
BEGIN
    ALTER TABLE Debts ADD supplierId VARCHAR(50) NULL;
END
GO

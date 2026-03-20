USE ContabilidadDB;
GO

-- Tabla Inventory (Inventario)
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Inventory' and xtype='U')
BEGIN
    CREATE TABLE Inventory (
        id VARCHAR(50) PRIMARY KEY,
        product VARCHAR(255) NOT NULL,
        quantity DECIMAL(18,2) NOT NULL DEFAULT 0,
        unitPrice DECIMAL(18,2) NOT NULL DEFAULT 0,
        location VARCHAR(100) NOT NULL,
        createdAt DATETIME DEFAULT GETDATE()
    );
END
GO

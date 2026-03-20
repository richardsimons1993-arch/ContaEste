USE ContabilidadDB;
GO
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='InventoryHistory' and xtype='U')
BEGIN
    CREATE TABLE InventoryHistory (
        id VARCHAR(50) PRIMARY KEY,
        productId VARCHAR(50) NOT NULL,
        productName VARCHAR(255),
        type VARCHAR(50) NOT NULL,
        origin VARCHAR(255),
        destination VARCHAR(255),
        quantityChange DECIMAL(18,2) DEFAULT 0,
        userId VARCHAR(50),
        userName VARCHAR(100),
        timestamp DATETIME DEFAULT GETDATE()
    );
END
GO

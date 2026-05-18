USE ContabilidadDB;
GO

-- Tabla Quotations (Cotizaciones)
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Quotations' and xtype='U')
BEGIN
    CREATE TABLE Quotations (
        id VARCHAR(50) PRIMARY KEY,        -- Automático ej: INO-2026-01
        correlative INT NOT NULL,          -- Numeración que se reinicia por año
        year INT NOT NULL,                 -- Año de emisión
        clientId VARCHAR(50) NOT NULL,
        clientName VARCHAR(255) NOT NULL,
        requirements TEXT,                 -- Requerimientos
        technicalConditions TEXT,          -- Condiciones técnicas
        items1 VARCHAR(MAX),               -- JSON con propuesta principal
        itemsOptional VARCHAR(MAX),        -- JSON con propuesta opcional
        subtotal DECIMAL(18,2) NOT NULL,
        iva DECIMAL(18,2) NOT NULL,
        total DECIMAL(18,2) NOT NULL,
        date DATETIME NOT NULL DEFAULT GETDATE()
    );
END
GO

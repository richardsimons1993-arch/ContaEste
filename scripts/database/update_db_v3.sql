USE ContabilidadDB;
GO

-- Crear tabla Contracts
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Contracts')
BEGIN
    CREATE TABLE Contracts (
        id VARCHAR(255) PRIMARY KEY,
        clientId VARCHAR(255) NOT NULL,
        amount DECIMAL(18,2) NOT NULL,
        startDate DATE NOT NULL,
        endDate DATE NOT NULL,
        billingDay INT NOT NULL,
        frequency VARCHAR(50) DEFAULT 'mensual',
        lastInvoicedPeriod VARCHAR(7) -- Formato 'YYYY-MM'
    );
END
GO

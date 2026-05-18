USE [ContabilidadDB];
GO

-- Crear tabla de Historial de Contratos si no existe
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='ContractHistory' and xtype='U')
BEGIN
    CREATE TABLE ContractHistory (
        id VARCHAR(255) PRIMARY KEY,
        contractId VARCHAR(255) NOT NULL,
        clientId VARCHAR(50) NOT NULL,
        periodName VARCHAR(50) NOT NULL,
        issueDate DATE NOT NULL,
        amount DECIMAL(18,2) NOT NULL,
        debtorId VARCHAR(255) NULL,
        FOREIGN KEY (contractId) REFERENCES Contracts(id),
        FOREIGN KEY (clientId) REFERENCES Clients(id)
    );
END
GO

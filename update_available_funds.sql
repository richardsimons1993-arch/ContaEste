IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'AvailableFunds')
BEGIN
    CREATE TABLE AvailableFunds (
        id VARCHAR(50) PRIMARY KEY,
        location VARCHAR(255) NOT NULL,
        classification VARCHAR(50) NOT NULL, -- Caja, Bancos, Inversiones
        instrument VARCHAR(100), -- Depósito a Plazo, Fondo Mutuo
        amount DECIMAL(18, 2) NOT NULL,
        placementDate DATE,
        dueDate DATE,
        observation VARCHAR(MAX)
    );
END
GO

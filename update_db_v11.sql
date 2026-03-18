USE ContabilidadDB;
GO

-- Tabla Availables (Activos Disponibles)
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Availables' and xtype='U')
BEGIN
    CREATE TABLE Availables (
        id VARCHAR(50) PRIMARY KEY,
        location VARCHAR(255) NOT NULL,
        classification VARCHAR(50) NOT NULL, -- 'Caja', 'Bancos', 'Inversiones'
        instrument VARCHAR(100), -- 'Depósito a Plazo', 'Fondo Mutuo', etc.
        amount DECIMAL(18,2) NOT NULL,
        placementDate DATE,
        dueDate DATE,
        observation TEXT
    );
END
GO

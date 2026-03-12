USE ContabilidadDB;
GO

-- Tabla Projects (Gestión de Ventas y Proyectos)
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Projects' and xtype='U')
BEGIN
    CREATE TABLE Projects (
        id VARCHAR(50) PRIMARY KEY,
        clientId VARCHAR(50) NOT NULL,
        status VARCHAR(50) NOT NULL, -- [Evaluación], [Cotizado], [Aprobado], [Materiales], [Ejecución]
        observations TEXT,
        visitDate DATE,
        executionDate DATE,
        createdAt DATETIME DEFAULT GETDATE(),
        FOREIGN KEY (clientId) REFERENCES Clients(id)
    );
END
GO

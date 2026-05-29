USE ContabilidadDB;
GO

IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Reports' AND xtype='U')
BEGIN
    CREATE TABLE Reports (
        id VARCHAR(50) NOT NULL,
        correlative INT NOT NULL,
        year INT NOT NULL,
        version INT NOT NULL,
        clientId VARCHAR(50) NOT NULL,
        clientName VARCHAR(255) NOT NULL,
        projectName VARCHAR(255) NOT NULL,
        generalData TEXT,
        scope TEXT,
        materials VARCHAR(MAX),
        results TEXT,
        conclusions TEXT,
        images VARCHAR(MAX),
        createdAt DATETIME DEFAULT GETDATE(),
        CONSTRAINT PK_Reports_Id_Version PRIMARY KEY (id, [version])
    );
END
GO

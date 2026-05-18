-- Crear Tabla de Notas con Privacidad por Usuario
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Notes' and xtype='U')
BEGIN
    CREATE TABLE Notes (
        id VARCHAR(50) PRIMARY KEY,
        userId VARCHAR(50) NOT NULL,
        title VARCHAR(255),
        content VARCHAR(MAX),
        type VARCHAR(50), -- 'text' o 'list'
        pinned BIT DEFAULT 0,
        lastModified DATETIME DEFAULT GETDATE(),
        CONSTRAINT FK_Notes_Users FOREIGN KEY (userId) REFERENCES Users(id) ON DELETE CASCADE
    );
    PRINT '✅ Tabla Notes creada con éxito.';
END
ELSE
BEGIN
    PRINT 'ℹ️ La tabla Notes ya existe.';
END
GO

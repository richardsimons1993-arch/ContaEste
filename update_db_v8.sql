USE ContabilidadDB;
GO

-- Tabla ProjectHistory (Bitácora de cambios de estado y notas)
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='ProjectHistory' and xtype='U')
BEGIN
    CREATE TABLE ProjectHistory (
        id INT IDENTITY(1,1) PRIMARY KEY,
        projectId VARCHAR(50) NOT NULL,
        previousStatus VARCHAR(50),
        newStatus VARCHAR(50) NOT NULL,
        note TEXT,
        changeDate DATETIME DEFAULT GETDATE(),
        FOREIGN KEY (projectId) REFERENCES Projects(id) ON DELETE CASCADE
    );
END
GO

-- Asegurar que la tabla Projects exista y tenga los campos necesarios
-- (Ya creada en v7, pero podemos agregar índices o campos si fuera necesario)
-- No hay cambios estructurales requeridos en Projects por ahora, ya que las fechas son opcionales.

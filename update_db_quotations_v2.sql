/*
  MIGRACIÓN: Cotizaciones v2
  Agrega campos para versiones y limpieza automática (90 días).
*/

IF NOT EXISTS (
    SELECT * FROM sys.columns 
    WHERE object_id = OBJECT_ID(N'[dbo].[Quotations]') 
    AND name = 'version'
)
BEGIN
    ALTER TABLE Quotations ADD [version] INT DEFAULT 1;
END
GO

IF NOT EXISTS (
    SELECT * FROM sys.columns 
    WHERE object_id = OBJECT_ID(N'[dbo].[Quotations]') 
    AND name = 'createdAt'
)
BEGIN
    ALTER TABLE Quotations ADD [createdAt] DATETIME DEFAULT GETDATE();
END
GO

-- Actualizar registros existentes para que tengan fecha si no la tienen
UPDATE Quotations SET createdAt = GETDATE() WHERE createdAt IS NULL;
UPDATE Quotations SET [version] = 1 WHERE [version] IS NULL;
GO

USE ContabilidadDB;
GO

-- Alterar la tabla Contracts para permitir que endDate sea NULL
ALTER TABLE Contracts ALTER COLUMN endDate DATE NULL;
GO

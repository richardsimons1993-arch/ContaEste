-- Migración de Base de Datos v16: Agregar clientId a Debtors
USE ContabilidadDB;
GO

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Debtors') AND name = 'clientId')
BEGIN
    ALTER TABLE Debtors ADD clientId VARCHAR(50) NULL;
END
GO

-- Intentar vincular deudores existentes con clientes por nombre
UPDATE D
SET D.clientId = C.id
FROM Debtors D
JOIN Clients C ON D.debtor = C.name OR D.debtor = C.nombreFantasia
WHERE D.clientId IS NULL;
GO

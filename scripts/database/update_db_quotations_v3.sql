/*
  MIGRACIÓN: Cotizaciones v3 - PK Compuesta
  Permite múltiples versiones del mismo ID de cotización.
*/

-- 1. Identificar el nombre de la restricción PRIMARY KEY
DECLARE @PK_Name NVARCHAR(200);
SELECT @PK_Name = name FROM sys.key_constraints WHERE type = 'PK' AND parent_object_id = OBJECT_ID('Quotations');

-- 2. Eliminar la PK actual (sobre 'id')
IF @PK_Name IS NOT NULL
BEGIN
    EXEC('ALTER TABLE Quotations DROP CONSTRAINT ' + @PK_Name);
END
GO

-- 3. Asegurar que las columnas para la nueva PK no sean NULL
ALTER TABLE Quotations ALTER COLUMN [id] VARCHAR(50) NOT NULL;
ALTER TABLE Quotations ALTER COLUMN [version] INT NOT NULL;
GO

-- 4. Crear la nueva PK compuesta (id, version)
ALTER TABLE Quotations ADD CONSTRAINT PK_Quotations_Id_Version PRIMARY KEY (id, [version]);
GO

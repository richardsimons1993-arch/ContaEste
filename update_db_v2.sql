USE ContabilidadDB;
GO

-- Añadir columnas faltantes a la tabla Clients
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Clients') AND name = 'nombreFantasia')
    ALTER TABLE Clients ADD nombreFantasia VARCHAR(255);

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Clients') AND name = 'rut')
    ALTER TABLE Clients ADD rut VARCHAR(50);

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Clients') AND name = 'encargado')
    ALTER TABLE Clients ADD encargado VARCHAR(255);

-- Renombrar campos si es necesario o simplemente mapearlos en el API. 
-- Para mantener compatibilidad con el código anterior de server.js que usa 'name', 'phone', 'email', 'address'
-- pero app.js usa 'razonSocial', 'telefono', 'correo', 'direccion'.
-- Lo mejor es que la tabla tenga los nombres que usa la app para evitar confusiones.

-- Pero para no romper lo que ya hay, mapearemos en server.js.
GO

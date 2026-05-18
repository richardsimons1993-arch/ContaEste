-- Migración de Base de Datos v15: Ubicaciones Globales de la Aplicación

-- Si ya existe InventoryLocations, la renombramos o creamos AppLocations como copia
IF OBJECT_ID('InventoryLocations', 'U') IS NOT NULL AND OBJECT_ID('AppLocations', 'U') IS NULL
BEGIN
    EXEC sp_rename 'InventoryLocations', 'AppLocations';
END
ELSE IF OBJECT_ID('AppLocations', 'U') IS NULL
BEGIN
    CREATE TABLE AppLocations (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(255) NOT NULL
    );
    
    -- Insertar valores iniciales si la tabla es nueva
    INSERT INTO AppLocations (id, name) VALUES ('1', 'Bodega Central');
    INSERT INTO AppLocations (id, name) VALUES ('2', 'Vehículo L2');
    INSERT INTO AppLocations (id, name) VALUES ('3', 'En Obra');
    INSERT INTO AppLocations (id, name) VALUES ('4', 'Banco de Chile');
    INSERT INTO AppLocations (id, name) VALUES ('5', 'Caja Fuerte');
END

-- Migración de Base de Datos v14: Soporte para Ubicaciones y Historial de Inventario

CREATE TABLE InventoryLocations (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255) NOT NULL
);

CREATE TABLE InventoryHistory (
    id VARCHAR(50) PRIMARY KEY,
    timestamp DATETIME DEFAULT GETDATE(),
    productId VARCHAR(50) NOT NULL,
    productName VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL, -- 'Entrada', 'Salida', 'Traslado', 'Baja'
    origin VARCHAR(255),
    destination VARCHAR(255),
    quantityChange DECIMAL(18, 2),
    userId VARCHAR(50),
    userName VARCHAR(100)
);

-- Insertar ubicaciones iniciales predeterminadas
INSERT INTO InventoryLocations (id, name) VALUES ('1', 'Bodega Central');
INSERT INTO InventoryLocations (id, name) VALUES ('2', 'Vehículo L2');
INSERT INTO InventoryLocations (id, name) VALUES ('3', 'En Obra');

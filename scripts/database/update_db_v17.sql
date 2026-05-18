-- Migración de Base de Datos v17: Categorización de Ubicaciones (Inventario vs Disponible)

-- 1. Agregar columna 'type' si no existe
IF COL_LENGTH('AppLocations', 'type') IS NULL
BEGIN
    ALTER TABLE AppLocations ADD type VARCHAR(50) DEFAULT 'inventory' NOT NULL;
END
GO

-- 2. Categorizar ubicaciones existentes
-- Fondos Disponibles
UPDATE AppLocations 
SET type = 'finance' 
WHERE name IN ('Banco de Chile', 'Caja Fuerte', 'Banco Estado', 'Banco Santander', 'Caja Oficina');

-- Inventario (Por defecto es 'inventory', pero aseguramos algunos casos conocidos)
UPDATE AppLocations 
SET type = 'inventory' 
WHERE name IN ('Bodega Central', 'Vehículo L2', 'En Obra', 'Bodega Norte', 'Bodega Sur');

GO

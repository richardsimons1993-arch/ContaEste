-- Actualizar módulos de administración para usuarios
USE ContabilidadDB;
GO

-- Agregar módulos de inventario y cotizaciones a administrador
UPDATE Users 
SET modules = '["finanzas", "ventas", "inventario", "cotizaciones", "usuarios"]' 
WHERE role = 'administrador';
PRINT 'Módulos de administrador actualizados';

-- Agregar módulos a operador
UPDATE Users 
SET modules = '["finanzas", "ventas", "inventario", "cotizaciones"]' 
WHERE role = 'operador';
PRINT 'Módulos de operador actualizados';

-- Agregar módulos a visualización
UPDATE Users 
SET modules = '["finanzas", "ventas", "inventario"]' 
WHERE role = 'visualización';
PRINT 'Módulos de visualización actualizados';

-- Mostrar resultado
SELECT id, username, role, modules FROM Users;
GO

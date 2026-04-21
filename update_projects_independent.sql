-- Actualizar módulos de administración para separar Proyectos
USE ContabilidadDB;
GO

-- Agregar módulos con Proyectos independiente a administrador
UPDATE Users 
SET modules = '["finanzas", "ventas", "proyectos", "inventario", "cotizaciones", "usuarios"]' 
WHERE role = 'administrador';
PRINT 'Módulos de administrador actualizados - Proyectos independiente';

-- Agregar módulos a operador con Proyectos independiente
UPDATE Users 
SET modules = '["finanzas", "ventas", "proyectos", "inventario", "cotizaciones"]' 
WHERE role = 'operador';
PRINT 'Módulos de operador actualizados - Proyectos independiente';

-- Agregar módulos a visualización con Proyectos independiente
UPDATE Users 
SET modules = '["finanzas", "ventas", "proyectos", "inventario"]' 
WHERE role = 'visualización';
PRINT 'Módulos de visualización actualizados - Proyectos independiente';

-- Mostrar resultado
SELECT id, username, role, modules FROM Users;
GO

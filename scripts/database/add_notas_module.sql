USE ContabilidadDB;
GO
UPDATE Users SET modules = '["finanzas", "ventas", "proyectos", "inventario", "cotizaciones", "usuarios", "notas"]' WHERE role = 'administrador';
UPDATE Users SET modules = '["finanzas", "ventas", "proyectos", "inventario", "cotizaciones", "notas"]' WHERE role = 'operador';
SELECT id, username, role, modules FROM Users;
GO

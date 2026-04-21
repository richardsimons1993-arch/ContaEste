USE ContabilidadDB;
GO
UPDATE Users SET modules = '["finanzas", "ventas", "proyectos", "inventario"]' WHERE username = 'lector';
SELECT id, username, role, modules FROM Users;
GO

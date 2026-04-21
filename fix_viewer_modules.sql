USE ContabilidadDB;
GO

UPDATE Users SET modules = '["finanzas", "ventas", "proyectos", "inventario"]' WHERE role = 'visualización';
SELECT * FROM Users;
GO

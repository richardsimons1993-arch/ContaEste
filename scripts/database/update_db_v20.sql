-- Insertar usuario administrador por defecto si no existe
IF NOT EXISTS (SELECT 1 FROM Users WHERE username = 'admin')
BEGIN
    INSERT INTO Users (id, username, password, role, name, modules)
    VALUES ('1', 'admin', 'admin', 'admin', 'Administrador', '["finanzas", "ventas", "inventario", "usuarios"]')
    PRINT '✅ Usuario administrador creado (admin/admin)'
END
ELSE
BEGIN
    PRINT 'ℹ️  El usuario administrador ya existe'
END
GO

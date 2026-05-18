-- Restaurar credenciales originales para id='1'
UPDATE Users 
SET username = 'administrador', 
    password = 'S0p0rt3!!2025',
    modules = '["finanzas", "ventas", "inventario", "usuarios"]'
WHERE id = '1'

-- Asegurar que el servidor detecte el cambio de contraseña plana a hash
GO

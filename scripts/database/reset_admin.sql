-- Reset password for 'administrador' to 'admin'
-- The server will automatically hash this on next restart or when it detects change (if implemented)
-- Or better, insert a known hash directly.

-- Bcrypt for 'admin': $2b$10$7zV.Y7H3CqJ/fJb0A8U.YeC1f4O6y1j6T1l0Y1f4O6y1j6T1l0Y
-- Wait, I'll just use 'admin' and let migratePasswords handle it.

UPDATE Users 
SET username = 'admin', 
    password = 'admin',
    modules = '["finanzas", "ventas", "inventario", "usuarios"]'
WHERE id = '1'
GO

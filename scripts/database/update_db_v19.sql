USE [ContabilidadDB];
GO

-- Crear tabla de Gastos Operacionales Recurrentes si no existe
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='OperationalExpenses' and xtype='U')
BEGIN
    CREATE TABLE OperationalExpenses (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        amount DECIMAL(18,2) NOT NULL,
        frequency VARCHAR(50) NOT NULL, -- 'monthly', 'quarterly', 'semiannually', 'yearly'
        lastPaymentDate DATE NULL,
        nextPaymentDate DATE NULL,
        description TEXT NULL,
        status VARCHAR(50) DEFAULT 'active'
    );
END
GO

-- Registrar actividad inicial (opcional, pero útil para trazabilidad si el sistema lo requiere)
-- Se asume que el sistema manejará los inserts desde el frontend/backend

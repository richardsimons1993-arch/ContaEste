-- Optimización de Rendimiento: Creación de Índices
-- Ejecutar en ContabilidadDB

-- 1. Transacciones (Búsqueda por fecha y tipo para dashboard)
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Transactions_Date_Type')
BEGIN
    CREATE INDEX IX_Transactions_Date_Type ON Transactions (date, type) INCLUDE (amount);
    PRINT '✅ Índice IX_Transactions_Date_Type creado';
END

-- 2. Transacciones (Búsqueda por concepto)
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Transactions_ConceptId')
BEGIN
    CREATE INDEX IX_Transactions_ConceptId ON Transactions (conceptId);
    PRINT '✅ Índice IX_Transactions_ConceptId creado';
END

-- 3. Proyectos (Búsqueda por cliente)
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Projects_ClientId')
BEGIN
    CREATE INDEX IX_Projects_ClientId ON Projects (clientId);
    PRINT '✅ Índice IX_Projects_ClientId creado';
END

-- 4. Inventario (Búsqueda por ubicación)
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Inventory_Location')
BEGIN
    CREATE INDEX IX_Inventory_Location ON Inventory (location);
    PRINT '✅ Índice IX_Inventory_Location creado';
END

-- 5. Deudas y Deudores (Fechas de vencimiento)
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Debts_DueDate')
BEGIN
    CREATE INDEX IX_Debts_DueDate ON Debts (dueDate);
END

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Debtors_DueDate')
BEGIN
    CREATE INDEX IX_Debtors_DueDate ON Debtors (dueDate);
END

GO

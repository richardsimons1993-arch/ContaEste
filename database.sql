-- Crear Base de Datos
IF NOT EXISTS (SELECT * FROM sys.databases WHERE name = 'ContabilidadDB')
BEGIN
    CREATE DATABASE ContabilidadDB;
END
GO

USE ContabilidadDB;
GO

-- Tabla Concepts
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Concepts' and xtype='U')
BEGIN
    CREATE TABLE Concepts (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        type VARCHAR(50) NOT NULL
    );
END
GO

-- Tabla Clients
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Clients' and xtype='U')
BEGIN
    CREATE TABLE Clients (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        phone VARCHAR(50),
        email VARCHAR(255),
        address VARCHAR(255)
    );
END
GO

-- Tabla Transactions
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Transactions' and xtype='U')
BEGIN
    CREATE TABLE Transactions (
        id VARCHAR(50) PRIMARY KEY,
        date DATE NOT NULL,
        type VARCHAR(50) NOT NULL,
        conceptId VARCHAR(50),
        clientId VARCHAR(50),
        amount DECIMAL(18,2) NOT NULL,
        observation TEXT
    );
END
GO

-- Tabla Debts (Lo que debo)
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Debts' and xtype='U')
BEGIN
    CREATE TABLE Debts (
        id VARCHAR(50) PRIMARY KEY,
        creditor VARCHAR(255) NOT NULL,
        amount DECIMAL(18,2) NOT NULL,
        dueDate DATE NOT NULL,
        description TEXT,
        status VARCHAR(50) DEFAULT 'pending'
    );
END
GO

-- Tabla Debtors (Lo que me deben)
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Debtors' and xtype='U')
BEGIN
    CREATE TABLE Debtors (
        id VARCHAR(50) PRIMARY KEY,
        debtor VARCHAR(255) NOT NULL,
        amount DECIMAL(18,2) NOT NULL,
        dueDate DATE NOT NULL,
        description TEXT,
        status VARCHAR(50) DEFAULT 'pending'
    );
END
GO

-- Tabla Users
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Users' and xtype='U')
BEGIN
    CREATE TABLE Users (
        id VARCHAR(50) PRIMARY KEY,
        username VARCHAR(100) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL,
        name VARCHAR(255) NOT NULL,
        modules VARCHAR(MAX) -- JSON string array
    );
END
GO

-- Tabla Logs
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Logs' and xtype='U')
BEGIN
    CREATE TABLE Logs (
        id VARCHAR(50) PRIMARY KEY,
        action VARCHAR(255) NOT NULL,
        module VARCHAR(100) NOT NULL,
        details TEXT,
        timestamp DATETIME NOT NULL
    );
END
GO

-- Insertar Conceptos por defecto si no existen
IF NOT EXISTS (SELECT 1 FROM Concepts)
BEGIN
    INSERT INTO Concepts (id, name, type) VALUES
    ('1', 'Ventas', 'income'),
    ('2', 'Servicios', 'income'),
    ('3', 'Alquiler', 'expense'),
    ('4', 'Servicios Públicos', 'expense'),
    ('5', 'Alimentos', 'expense'),
    ('6', 'Transporte', 'expense');
END
GO

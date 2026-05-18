IF NOT EXISTS (SELECT * FROM sys.columns WHERE name = 'estimatedAmount' AND object_id = OBJECT_ID('Projects'))
BEGIN
    ALTER TABLE Projects ADD estimatedAmount DECIMAL(18,2) NULL;
END
GO

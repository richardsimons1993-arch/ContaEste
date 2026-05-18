USE ContabilidadDB;
GO

-- Convertir observaciones en Projects de TEXT a VARCHAR(MAX)
ALTER TABLE Projects ALTER COLUMN observations VARCHAR(MAX);
GO

-- Convertir notas en ProjectHistory de TEXT a VARCHAR(MAX)
ALTER TABLE ProjectHistory ALTER COLUMN note VARCHAR(MAX);
GO

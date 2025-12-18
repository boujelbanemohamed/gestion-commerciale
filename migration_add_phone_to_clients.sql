-- Migration: Ajouter la colonne phone à la table clients
-- Ce script peut être exécuté pour mettre à jour une base de données existante

-- Vérifier si la colonne existe déjà avant de l'ajouter
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'clients' 
        AND column_name = 'phone'
    ) THEN
        ALTER TABLE clients ADD COLUMN phone VARCHAR(50);
    END IF;
END $$;



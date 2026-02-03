-- Ajouter le champ mode_calcul aux devis : 'ht' = prix saisis en HT, 'ttc' = prix saisis en TTC
-- Valeur par défaut 'ttc' pour conserver le comportement actuel
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS mode_calcul VARCHAR(10) DEFAULT 'ttc';
COMMENT ON COLUMN quotes.mode_calcul IS 'ht = prix unitaires en HT, ttc = prix unitaires en TTC';

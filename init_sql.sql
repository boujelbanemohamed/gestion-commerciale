-- Création des tables

-- Table des utilisateurs
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'admin',
    signature_text TEXT,
    signature_file_path VARCHAR(500),
    signature_link TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table des clients
CREATE TABLE IF NOT EXISTS clients (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(50),
    matricule_fiscal VARCHAR(50),
    address TEXT ,
    city VARCHAR(100) NOT NULL,
    postal_code VARCHAR(20) NOT NULL,
    country VARCHAR(100) NOT NULL DEFAULT 'France',
    logo_file_path VARCHAR(500),
    logo_url TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table des contacts clients
CREATE TABLE IF NOT EXISTS client_contacts (
    id SERIAL PRIMARY KEY,
    client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    position VARCHAR(100),
    email VARCHAR(255),
    phone VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table des catégories
CREATE TABLE IF NOT EXISTS categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table des devises
CREATE TABLE IF NOT EXISTS currencies (
    id SERIAL PRIMARY KEY,
    code VARCHAR(10) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    symbol VARCHAR(10) NOT NULL,
    decimals INTEGER DEFAULT 2,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table des taux de TVA
CREATE TABLE IF NOT EXISTS vat_rates (
    id SERIAL PRIMARY KEY,
    rate DECIMAL(5,2) NOT NULL,
    label VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table des produits
CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    reference VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    price_ht DECIMAL(10,2) NOT NULL,
    vat_rate_id INTEGER REFERENCES vat_rates(id) ON DELETE SET NULL,
    currency_id INTEGER REFERENCES currencies(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table des devis
CREATE TABLE IF NOT EXISTS quotes (
    id SERIAL PRIMARY KEY,
    quote_number VARCHAR(50) UNIQUE NOT NULL,
    client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    valid_until DATE NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    total_ht DECIMAL(10,2) DEFAULT 0,
    total_vat DECIMAL(10,2) DEFAULT 0,
    total_ttc DECIMAL(10,2) DEFAULT 0,
    notes TEXT,
    first_page_text TEXT,
    introduction_text TEXT,
    currency_id INTEGER REFERENCES currencies(id) ON DELETE SET NULL,
    conditions_generales TEXT,
    global_discount_percent DECIMAL(5,2) DEFAULT 0,
    mode_calcul VARCHAR(3) DEFAULT 'HT' CHECK (mode_calcul IN ('HT', 'TTC')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table des lignes de devis
CREATE TABLE IF NOT EXISTS quote_items (
    id SERIAL PRIMARY KEY,
    quote_id INTEGER REFERENCES quotes(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    product_name VARCHAR(255) NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price DECIMAL(10,2) NOT NULL,
    vat_rate DECIMAL(5,2) NOT NULL,
    discount_percent DECIMAL(5,2) DEFAULT 0,
    total_ht DECIMAL(10,2) NOT NULL,
    total_vat DECIMAL(10,2) NOT NULL,
    total_ttc DECIMAL(10,2) NOT NULL,
    product_currency_id INTEGER REFERENCES currencies(id) ON DELETE SET NULL,
    exchange_rate DECIMAL(10,4) DEFAULT 1.0000,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table des pièces jointes des devis
CREATE TABLE IF NOT EXISTS quote_attachments (
    id SERIAL PRIMARY KEY,
    quote_id INTEGER REFERENCES quotes(id) ON DELETE CASCADE,
    filename VARCHAR(255) NOT NULL,
    original_filename VARCHAR(255) NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    file_size INTEGER,
    mime_type VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table des commentaires sur les devis
CREATE TABLE IF NOT EXISTS quote_comments (
    id SERIAL PRIMARY KEY,
    quote_id INTEGER REFERENCES quotes(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    assigned_to_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    comment TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table des notifications
CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    quote_id INTEGER REFERENCES quotes(id) ON DELETE CASCADE,
    comment_id INTEGER REFERENCES quote_comments(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL DEFAULT 'comment_assigned',
    message TEXT NOT NULL,
    read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table de configuration
CREATE TABLE IF NOT EXISTS app_config (
    id SERIAL PRIMARY KEY,
    config_key VARCHAR(100) UNIQUE NOT NULL,
    config_value TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insertion de données de test

-- Utilisateur par défaut (mot de passe: admin123)
INSERT INTO users (email, password, name, role) 
VALUES ('admin@demo.com', '$2b$10$rZ8YvVYvzPvZ0xMxZKZhCeGXMfZJZqYvXDZJZqYvXDZJZqYvXDZ', 'Administrateur', 'admin');

-- Catégories
INSERT INTO categories (name, description) VALUES 
('Électronique', 'Produits électroniques'),
('Informatique', 'Matériel informatique'),
('Accessoires', 'Accessoires divers'),
('Services', 'Services divers'),
('Produits', 'Produits physiques'),
('Consulting', 'Services de conseil');

-- Devises
INSERT INTO currencies (code, name, symbol, decimals) VALUES 
('EUR', 'Euro', '€', 2),
('USD', 'Dollar américain', '$', 2),
('TND', 'Dinar tunisien', 'د.ت', 3),
('GBP', 'Livre sterling', '£', 2);

-- Taux de TVA
INSERT INTO vat_rates (rate, label) VALUES 
(7.00, 'TVA 7%'),
(19.00, 'TVA 19%'),
(20.00, 'TVA 20%');

-- Produits de test
INSERT INTO products (reference, name, description, category_id, price_ht, vat_rate_id, currency_id) VALUES 
('PRD-001', 'Smartphone X-Pro', 'Smartphone dernière génération', 1, 832.50, 3, 1),
('PRD-002', 'Ordinateur Portable Ultra', 'PC portable haute performance', 2, 1249.17, 3, 1),
('PRD-003', 'Casque Audio ProSound', 'Casque audio professionnel', 3, 165.83, 3, 1);

-- Clients de test
INSERT INTO clients (name, email, phone, address, city, postal_code, country) VALUES
('Alice Martin', 'alice.martin@example.com', '01 23 45 67 89', '1 Rue de Paris', 'Paris', '75001', 'France'),
('Bob Dupont', 'bob.dupont@example.com', '06 11 22 33 44', '2 Avenue de Lyon', 'Lyon', '69001', 'France'),
('Carla Moreau', 'carla.moreau@example.com', '04 98 76 54 32', '3 Boulevard de Marseille', 'Marseille', '13001', 'France');

-- Configuration SMTP
INSERT INTO app_config (config_key, config_value) VALUES 
('smtp_server', 'smtp.gmail.com'),
('smtp_port', '587'),
('smtp_secure', 'false'),
('smtp_user', 'votre@email.com'),
('smtp_password', ''),
('smtp_sender_email', 'contact@entreprise.com'),
('smtp_sender_name', 'Mon Entreprise')
ON CONFLICT (config_key) DO NOTHING;

-- Index pour améliorer les performances
CREATE INDEX idx_clients_email ON clients(email);
CREATE INDEX idx_products_reference ON products(reference);
CREATE INDEX idx_quotes_number ON quotes(quote_number);
CREATE INDEX idx_quotes_client ON quotes(client_id);
CREATE INDEX idx_quote_items_quote ON quote_items(quote_id);

-- Ajouter les colonnes manquantes si elles n'existent pas déjà
DO $$ 
BEGIN
    -- Colonnes pour quotes
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='quotes' AND column_name='currency_id') THEN
        ALTER TABLE quotes ADD COLUMN currency_id INTEGER REFERENCES currencies(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='quotes' AND column_name='conditions_generales') THEN
        ALTER TABLE quotes ADD COLUMN conditions_generales TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='quotes' AND column_name='global_discount_percent') THEN
        ALTER TABLE quotes ADD COLUMN global_discount_percent DECIMAL(5,2) DEFAULT 0;
    END IF;
    
    -- Colonnes pour quote_items
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='quote_items' AND column_name='discount_percent') THEN
        ALTER TABLE quote_items ADD COLUMN discount_percent DECIMAL(5,2) DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='quote_items' AND column_name='product_currency_id') THEN
        ALTER TABLE quote_items ADD COLUMN product_currency_id INTEGER REFERENCES currencies(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='quote_items' AND column_name='exchange_rate') THEN
        ALTER TABLE quote_items ADD COLUMN exchange_rate DECIMAL(10,4) DEFAULT 1.0000;
    END IF;
    
    -- Créer la table quote_attachments si elle n'existe pas
    CREATE TABLE IF NOT EXISTS quote_attachments (
        id SERIAL PRIMARY KEY,
        quote_id INTEGER REFERENCES quotes(id) ON DELETE CASCADE,
        filename VARCHAR(255) NOT NULL,
        original_filename VARCHAR(255) NOT NULL,
        file_path VARCHAR(500) NOT NULL,
        file_size INTEGER,
        mime_type VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
END $$;

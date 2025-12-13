require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { Pool } = require('pg');
const nodemailer = require('nodemailer');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 5000;

// Configuration de la base de données
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'gestion_commerciale',
  user: process.env.DB_USER || 'admin',
  password: process.env.DB_PASSWORD || 'admin123',
});

// Test de connexion à la base de données
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('❌ Erreur de connexion à la base de données:', err);
  } else {
    console.log('✅ Connexion à PostgreSQL réussie:', res.rows[0].now);
  }
});

// Créer le dossier pour les uploads s'il n'existe pas
const uploadsDir = path.join(__dirname, 'uploads', 'quotes');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configuration Multer pour les uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'quote-' + req.params.id + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB max
  }
});

// Middleware
app.use(helmet());
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Middleware pour attacher pool à req
app.use((req, res, next) => {
  req.pool = pool;
  next();
});

// Routes de base
app.get('/api', (req, res) => {
  res.json({ 
    message: 'API Gestion Commerciale',
    version: '1.0.0',
    status: 'running'
  });
});

// ==================== ROUTES AUTH ====================
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    }

    // Dans un vrai système, utilisez bcrypt pour comparer
    // const isValid = await bcrypt.compare(password, result.rows[0].password);
    
    const user = result.rows[0];
    res.json({
      message: 'Connexion réussie',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: (user.role || 'lecteur').toLowerCase()
      },
      token: 'fake_jwt_token_' + user.id
    });
  } catch (error) {
    console.error('Erreur login:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Route pour obtenir le profil de l'utilisateur connecté
// Note: Dans un vrai système, on utiliserait le token JWT pour identifier l'utilisateur
// Pour l'instant, on accepte l'ID utilisateur dans les paramètres de requête
app.get('/api/auth/profile', async (req, res) => {
  try {
    const { userId } = req.query;
    
    if (!userId) {
      return res.status(400).json({ error: 'ID utilisateur requis' });
    }
    
    const result = await pool.query(
      'SELECT id, email, name, role, created_at, updated_at FROM users WHERE id = $1',
      [userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }
    
    const user = result.rows[0];
    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      role: (user.role || 'lecteur').toLowerCase(),
      created_at: user.created_at,
      updated_at: user.updated_at
    });
  } catch (error) {
    console.error('Erreur récupération profil:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Route pour mettre à jour le profil de l'utilisateur connecté
app.put('/api/auth/profile', async (req, res) => {
  try {
    const { userId, name, email, password } = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: 'ID utilisateur requis' });
    }
    
    // Vérifier que l'utilisateur existe
    const existingUser = await pool.query('SELECT id FROM users WHERE id = $1', [userId]);
    if (existingUser.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }
    
    // Vérifier que l'email n'est pas utilisé par un autre utilisateur
    if (email) {
      const emailCheck = await pool.query('SELECT id FROM users WHERE email = $1 AND id != $2', [email, userId]);
      if (emailCheck.rows.length > 0) {
        return res.status(400).json({ error: 'Cet email est déjà utilisé' });
      }
    }
    
    // Construire la requête de mise à jour dynamiquement
    const updates = [];
    const values = [];
    let paramIndex = 1;
    
    if (email) {
      updates.push(`email = $${paramIndex++}`);
      values.push(email);
    }
    if (password) {
      // Dans un vrai système, hasher le mot de passe avec bcrypt
      // const hashedPassword = await bcrypt.hash(password, 10);
      updates.push(`password = $${paramIndex++}`);
      values.push(password);
    }
    if (name) {
      updates.push(`name = $${paramIndex++}`);
      values.push(name);
    }
    
    if (updates.length === 0) {
      return res.status(400).json({ error: 'Aucune donnée à mettre à jour' });
    }
    
    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(userId);
    
    const result = await pool.query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING id, email, name, role, created_at, updated_at`,
      values
    );
    
    res.json({
      id: result.rows[0].id,
      email: result.rows[0].email,
      name: result.rows[0].name,
      role: (result.rows[0].role || 'lecteur').toLowerCase(),
      created_at: result.rows[0].created_at,
      updated_at: result.rows[0].updated_at
    });
  } catch (error) {
    console.error('Erreur modification profil:', error);
    if (error.code === '23505') {
      return res.status(400).json({ error: 'Cet email est déjà utilisé' });
    }
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ==================== ROUTES UTILISATEURS ====================
app.get('/api/users', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, email, name, role, created_at, updated_at FROM users ORDER BY created_at DESC'
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Erreur récupération utilisateurs:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.get('/api/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'SELECT id, email, name, role, created_at, updated_at FROM users WHERE id = $1',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Erreur récupération utilisateur:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/users', async (req, res) => {
  try {
    const { email, password, name, role } = req.body;
    
    // Vérifier que l'email n'existe pas déjà
    const existingUser = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'Cet email est déjà utilisé' });
    }
    
    // Valider le rôle
    const validRoles = ['admin', 'commercial', 'lecteur'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: 'Rôle invalide. Rôles valides: admin, commercial, lecteur' });
    }
    
    // Dans un vrai système, hasher le mot de passe avec bcrypt
    // const hashedPassword = await bcrypt.hash(password, 10);
    
    const result = await pool.query(
      `INSERT INTO users (email, password, name, role) 
       VALUES ($1, $2, $3, $4) RETURNING id, email, name, role, created_at, updated_at`,
      [email, password, name, role || 'lecteur']
    );
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Erreur création utilisateur:', error);
    if (error.code === '23505') {
      return res.status(400).json({ error: 'Cet email est déjà utilisé' });
    }
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.put('/api/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { email, password, name, role } = req.body;
    
    // Vérifier que l'utilisateur existe
    const existingUser = await pool.query('SELECT id FROM users WHERE id = $1', [id]);
    if (existingUser.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }
    
    // Vérifier que l'email n'est pas utilisé par un autre utilisateur
    if (email) {
      const emailCheck = await pool.query('SELECT id FROM users WHERE email = $1 AND id != $2', [email, id]);
      if (emailCheck.rows.length > 0) {
        return res.status(400).json({ error: 'Cet email est déjà utilisé' });
      }
    }
    
    // Valider le rôle si fourni
    if (role) {
      const validRoles = ['admin', 'commercial', 'lecteur'];
      if (!validRoles.includes(role)) {
        return res.status(400).json({ error: 'Rôle invalide. Rôles valides: admin, commercial, lecteur' });
      }
    }
    
    // Construire la requête de mise à jour dynamiquement
    const updates = [];
    const values = [];
    let paramIndex = 1;
    
    if (email) {
      updates.push(`email = $${paramIndex++}`);
      values.push(email);
    }
    if (password) {
      // Dans un vrai système, hasher le mot de passe avec bcrypt
      // const hashedPassword = await bcrypt.hash(password, 10);
      updates.push(`password = $${paramIndex++}`);
      values.push(password);
    }
    if (name) {
      updates.push(`name = $${paramIndex++}`);
      values.push(name);
    }
    if (role) {
      updates.push(`role = $${paramIndex++}`);
      values.push(role);
    }
    
    if (updates.length === 0) {
      return res.status(400).json({ error: 'Aucune donnée à mettre à jour' });
    }
    
    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(id);
    
    const result = await pool.query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING id, email, name, role, created_at, updated_at`,
      values
    );
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Erreur modification utilisateur:', error);
    if (error.code === '23505') {
      return res.status(400).json({ error: 'Cet email est déjà utilisé' });
    }
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.delete('/api/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Vérifier que l'utilisateur existe
    const existingUser = await pool.query('SELECT id FROM users WHERE id = $1', [id]);
    if (existingUser.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }
    
    // Empêcher la suppression du dernier admin
    const adminCount = await pool.query("SELECT COUNT(*) FROM users WHERE role = 'admin'");
    const userRole = await pool.query('SELECT role FROM users WHERE id = $1', [id]);
    
    if (userRole.rows[0].role === 'admin' && parseInt(adminCount.rows[0].count) <= 1) {
      return res.status(400).json({ error: 'Impossible de supprimer le dernier administrateur' });
    }
    
    await pool.query('DELETE FROM users WHERE id = $1', [id]);
    
    res.json({ message: 'Utilisateur supprimé avec succès' });
  } catch (error) {
    console.error('Erreur suppression utilisateur:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ==================== ROUTES CLIENTS ====================
app.get('/api/clients', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.*, 
              COALESCE(json_agg(cc.*) FILTER (WHERE cc.id IS NOT NULL), '[]') as contacts
       FROM clients c
       LEFT JOIN client_contacts cc ON c.id = cc.client_id
       GROUP BY c.id
       ORDER BY c.created_at DESC`
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Erreur récupération clients:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.get('/api/clients/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT c.*, 
              COALESCE(json_agg(cc.*) FILTER (WHERE cc.id IS NOT NULL), '[]') as contacts
       FROM clients c
       LEFT JOIN client_contacts cc ON c.id = cc.client_id
       WHERE c.id = $1
       GROUP BY c.id`,
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Client non trouvé' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Erreur récupération client:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/clients', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { name, email, phone, matricule_fiscal, address, city, postal_code, country, contacts } = req.body;
    
    // Créer le client
    const result = await client.query(
      `INSERT INTO clients (name, email, phone, matricule_fiscal, address, city, postal_code, country) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [name, email, phone || null, matricule_fiscal || null, address, city, postal_code, country]
    );
    
    const clientId = result.rows[0].id;
    
    // Créer les contacts si fournis
    if (contacts && Array.isArray(contacts) && contacts.length > 0) {
      for (const contact of contacts) {
        if (contact.name) {
          await client.query(
            `INSERT INTO client_contacts (client_id, name, position, email, phone) 
             VALUES ($1, $2, $3, $4, $5)`,
            [clientId, contact.name, contact.position || null, contact.email || null, contact.phone || null]
          );
        }
      }
    }
    
    await client.query('COMMIT');
    
    // Récupérer le client avec ses contacts
    const clientWithContacts = await pool.query(
      `SELECT c.*, 
              COALESCE(json_agg(cc.*) FILTER (WHERE cc.id IS NOT NULL), '[]') as contacts
       FROM clients c
       LEFT JOIN client_contacts cc ON c.id = cc.client_id
       WHERE c.id = $1
       GROUP BY c.id`,
      [clientId]
    );
    
    res.status(201).json(clientWithContacts.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erreur création client:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

app.put('/api/clients/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { id } = req.params;
    const { name, email, phone, matricule_fiscal, address, city, postal_code, country, contacts } = req.body;
    
    // Mettre à jour le client
    const result = await client.query(
      `UPDATE clients 
       SET name = $1, email = $2, phone = $3, matricule_fiscal = $4, address = $5, 
           city = $6, postal_code = $7, country = $8, updated_at = CURRENT_TIMESTAMP
       WHERE id = $9 RETURNING *`,
      [name, email, phone || null, matricule_fiscal || null, address, city, postal_code, country, id]
    );
    
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Client non trouvé' });
    }
    
    // Supprimer les anciens contacts
    await client.query('DELETE FROM client_contacts WHERE client_id = $1', [id]);
    
    // Créer les nouveaux contacts si fournis
    if (contacts && Array.isArray(contacts) && contacts.length > 0) {
      for (const contact of contacts) {
        if (contact.name) {
          await client.query(
            `INSERT INTO client_contacts (client_id, name, position, email, phone) 
             VALUES ($1, $2, $3, $4, $5)`,
            [id, contact.name, contact.position || null, contact.email || null, contact.phone || null]
          );
        }
      }
    }
    
    await client.query('COMMIT');
    
    // Récupérer le client avec ses contacts
    const clientWithContacts = await pool.query(
      `SELECT c.*, 
              COALESCE(json_agg(cc.*) FILTER (WHERE cc.id IS NOT NULL), '[]') as contacts
       FROM clients c
       LEFT JOIN client_contacts cc ON c.id = cc.client_id
       WHERE c.id = $1
       GROUP BY c.id`,
      [id]
    );
    
    res.json(clientWithContacts.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erreur mise à jour client:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

app.delete('/api/clients/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM clients WHERE id = $1 RETURNING *', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Client non trouvé' });
    }
    
    res.json({ message: 'Client supprimé avec succès' });
  } catch (error) {
    console.error('Erreur suppression client:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ==================== ROUTES PRODUITS ====================
app.get('/api/products', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.*, c.name as category_name, v.rate as vat_rate, 
             cur.symbol as currency_symbol
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN vat_rates v ON p.vat_rate_id = v.id
      LEFT JOIN currencies cur ON p.currency_id = cur.id
      ORDER BY p.created_at DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Erreur récupération produits:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.get('/api/products/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT p.*, c.name as category_name, c.id as category_id,
             v.rate as vat_rate, v.id as vat_rate_id, v.label as vat_rate_label,
             cur.symbol as currency_symbol, cur.id as currency_id, cur.code as currency_code, cur.name as currency_name
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN vat_rates v ON p.vat_rate_id = v.id
      LEFT JOIN currencies cur ON p.currency_id = cur.id
      WHERE p.id = $1
    `, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Produit non trouvé' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Erreur récupération produit:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/products', async (req, res) => {
  try {
    const { reference, name, description, category_id, price_ht, vat_rate_id, currency_id } = req.body;
    
    const result = await pool.query(
      `INSERT INTO products (reference, name, description, category_id, price_ht, vat_rate_id, currency_id) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [reference, name, description, category_id, price_ht, vat_rate_id, currency_id]
    );
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Erreur création produit:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.put('/api/products/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { reference, name, description, category_id, price_ht, vat_rate_id, currency_id } = req.body;
    
    const result = await pool.query(
      `UPDATE products 
       SET reference = $1, name = $2, description = $3, category_id = $4, 
           price_ht = $5, vat_rate_id = $6, currency_id = $7, updated_at = CURRENT_TIMESTAMP
       WHERE id = $8 RETURNING *`,
      [reference, name, description, category_id, price_ht, vat_rate_id, currency_id, id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Produit non trouvé' });
    }
    
    // Récupérer le produit avec les jointures pour retourner les données complètes
    const productResult = await pool.query(`
      SELECT p.*, c.name as category_name, c.id as category_id,
             v.rate as vat_rate, v.id as vat_rate_id, v.label as vat_rate_label,
             cur.symbol as currency_symbol, cur.id as currency_id, cur.code as currency_code, cur.name as currency_name
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN vat_rates v ON p.vat_rate_id = v.id
      LEFT JOIN currencies cur ON p.currency_id = cur.id
      WHERE p.id = $1
    `, [id]);
    
    res.json(productResult.rows[0]);
  } catch (error) {
    console.error('Erreur modification produit:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.delete('/api/products/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM products WHERE id = $1', [id]);
    res.json({ message: 'Produit supprimé avec succès' });
  } catch (error) {
    console.error('Erreur suppression produit:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ==================== ROUTES DEVIS ====================
app.get('/api/quotes', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT q.*, c.name as client_name
      FROM quotes q
      LEFT JOIN clients c ON q.client_id = c.id
      ORDER BY q.created_at DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Erreur récupération devis:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.get('/api/quotes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const quoteResult = await pool.query(`
      SELECT q.*, c.name as client_name, c.email as client_email,
             curr.code as currency_code, curr.symbol as currency_symbol
      FROM quotes q
      LEFT JOIN clients c ON q.client_id = c.id
      LEFT JOIN currencies curr ON q.currency_id = curr.id
      WHERE q.id = $1
    `, [id]);
    
    if (quoteResult.rows.length === 0) {
      return res.status(404).json({ error: 'Devis non trouvé' });
    }
    
    const quote = quoteResult.rows[0];
    
    const itemsResult = await pool.query(
      'SELECT * FROM quote_items WHERE quote_id = $1 ORDER BY id',
      [id]
    );
    
    // Récupérer les pièces jointes
    const attachmentsResult = await pool.query(
      'SELECT * FROM quote_attachments WHERE quote_id = $1 ORDER BY created_at DESC',
      [id]
    );
    
    // Récupérer les contacts du client
    let clientContacts = [];
    if (quote.client_id) {
      const contactsResult = await pool.query(
        'SELECT * FROM client_contacts WHERE client_id = $1 ORDER BY name',
        [quote.client_id]
      );
      clientContacts = contactsResult.rows;
    }
    
    // Récupérer les commentaires avec les informations des utilisateurs
    const commentsResult = await pool.query(`
      SELECT 
        qc.*,
        u.name as user_name,
        u.email as user_email,
        atu.name as assigned_to_name,
        atu.email as assigned_to_email
      FROM quote_comments qc
      LEFT JOIN users u ON qc.user_id = u.id
      LEFT JOIN users atu ON qc.assigned_to_user_id = atu.id
      WHERE qc.quote_id = $1
      ORDER BY qc.created_at DESC
    `, [id]);
    
    res.json({
      ...quote,
      items: itemsResult.rows,
      attachments: attachmentsResult.rows,
      client_contacts: clientContacts,
      comments: commentsResult.rows
    });
  } catch (error) {
    console.error('Erreur récupération devis:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/quotes', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const { 
      client_id, 
      date, 
      valid_until, 
      status,
      currency_id,
      conditions_generales,
      global_discount_percent,
      items 
    } = req.body;
    
    // Générer un numéro de devis unique
    const countResult = await client.query('SELECT COUNT(*) FROM quotes');
    const count = parseInt(countResult.rows[0].count) + 1;
    const quoteNumber = `DEV-${String(count).padStart(6, '0')}`;
    
    // Calculer les totaux
    let totalHTAvantRemise = 0;
    let totalHTApresRemise = 0;
    let totalTVA = 0;
    
    if (items && Array.isArray(items) && items.length > 0) {
      items.forEach(item => {
        const qty = parseFloat(item.quantity) || 0;
        const prixHT = parseFloat(item.unit_price) || 0;
        const discount = parseFloat(item.discount_percent) || 0;
        const tva = parseFloat(item.vat_rate) || 0;
        
        const totalLigneAvantRemise = qty * prixHT;
        const montantRemise = (totalLigneAvantRemise * discount) / 100;
        const totalLigneHT = totalLigneAvantRemise - montantRemise;
        const montantTVA = (totalLigneHT * tva) / 100;
        
        totalHTAvantRemise += totalLigneAvantRemise;
        totalHTApresRemise += totalLigneHT;
        totalTVA += montantTVA;
      });
    }
    
    // Appliquer la remise globale
    const remiseGlobale = parseFloat(global_discount_percent) || 0;
    const montantRemiseGlobale = (totalHTApresRemise * remiseGlobale) / 100;
    totalHTApresRemise = totalHTApresRemise - montantRemiseGlobale;
    const totalTTC = totalHTApresRemise + totalTVA;
    
    // Créer le devis
    const result = await client.query(
      `INSERT INTO quotes (
        quote_number, client_id, date, valid_until, status, 
        currency_id, conditions_generales, global_discount_percent,
        total_ht, total_vat, total_ttc
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [
        quoteNumber, 
        client_id, 
        date, 
        valid_until, 
        status || 'pending',
        currency_id || null,
        conditions_generales || null,
        remiseGlobale,
        totalHTApresRemise,
        totalTVA,
        totalTTC
      ]
    );
    
    const quoteId = result.rows[0].id;
    
    // Créer les lignes de devis
    if (items && Array.isArray(items) && items.length > 0) {
      for (const item of items) {
        const qty = parseFloat(item.quantity) || 0;
        let prixHT = parseFloat(item.unit_price) || 0;
        const discount = parseFloat(item.discount_percent) || 0;
        const tva = parseFloat(item.vat_rate) || 0;
        const exchangeRate = parseFloat(item.exchange_rate) || 1.0;
        const productCurrencyId = item.product_currency_id || null;
        
        // Convertir le prix dans la devise du devis
        prixHT = prixHT * exchangeRate;
        
        const totalLigneAvantRemise = qty * prixHT;
        const montantRemise = (totalLigneAvantRemise * discount) / 100;
        const totalLigneHT = totalLigneAvantRemise - montantRemise;
        const montantTVA = (totalLigneHT * tva) / 100;
        const totalLigneTTC = totalLigneHT + montantTVA;
        
        await client.query(
          `INSERT INTO quote_items (
            quote_id, product_id, product_name, quantity, unit_price, 
            vat_rate, discount_percent, total_ht, total_vat, total_ttc,
            product_currency_id, exchange_rate
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            quoteId,
            item.product_id || null,
            item.product_name || '',
            qty,
            prixHT,
            tva,
            discount,
            totalLigneHT,
            montantTVA,
            totalLigneTTC,
            productCurrencyId,
            exchangeRate
          ]
        );
      }
    }
    
    await client.query('COMMIT');
    
    // Récupérer le devis complet avec les informations du client
    const quoteWithClient = await pool.query(`
      SELECT q.*, c.name as client_name, c.email as client_email,
             curr.code as currency_code, curr.symbol as currency_symbol
      FROM quotes q
      LEFT JOIN clients c ON q.client_id = c.id
      LEFT JOIN currencies curr ON q.currency_id = curr.id
      WHERE q.id = $1
    `, [quoteId]);
    
    // Récupérer les lignes de devis
    const itemsResult = await pool.query(
      'SELECT * FROM quote_items WHERE quote_id = $1 ORDER BY id',
      [quoteId]
    );
    
    res.status(201).json({
      ...quoteWithClient.rows[0],
      items: itemsResult.rows
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erreur création devis:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

app.put('/api/quotes/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const { id } = req.params;
    const { 
      client_id, 
      date, 
      valid_until, 
      status,
      currency_id,
      conditions_generales,
      global_discount_percent,
      items 
    } = req.body;
    
    // Vérifier que le devis existe
    const existingQuote = await client.query('SELECT id FROM quotes WHERE id = $1', [id]);
    if (existingQuote.rows.length === 0) {
      return res.status(404).json({ error: 'Devis non trouvé' });
    }
    
    // Calculer les totaux
    let totalHTAvantRemise = 0;
    let totalHTApresRemise = 0;
    let totalTVA = 0;
    
    if (items && Array.isArray(items) && items.length > 0) {
      items.forEach(item => {
        const qty = parseFloat(item.quantity) || 0;
        let prixHT = parseFloat(item.unit_price) || 0;
        const discount = parseFloat(item.discount_percent) || 0;
        const tva = parseFloat(item.vat_rate) || 0;
        const exchangeRate = parseFloat(item.exchange_rate) || 1.0;
        
        // Convertir le prix dans la devise du devis
        prixHT = prixHT * exchangeRate;
        
        const totalLigneAvantRemise = qty * prixHT;
        const montantRemise = (totalLigneAvantRemise * discount) / 100;
        const totalLigneHT = totalLigneAvantRemise - montantRemise;
        const montantTVA = (totalLigneHT * tva) / 100;
        
        totalHTAvantRemise += totalLigneAvantRemise;
        totalHTApresRemise += totalLigneHT;
        totalTVA += montantTVA;
      });
    }
    
    // Appliquer la remise globale
    const remiseGlobale = parseFloat(global_discount_percent) || 0;
    const montantRemiseGlobale = (totalHTApresRemise * remiseGlobale) / 100;
    totalHTApresRemise = totalHTApresRemise - montantRemiseGlobale;
    const totalTTC = totalHTApresRemise + totalTVA;
    
    // Mettre à jour le devis
    await client.query(
      `UPDATE quotes SET
        client_id = $1, date = $2, valid_until = $3, status = $4,
        currency_id = $5, conditions_generales = $6, global_discount_percent = $7,
        total_ht = $8, total_vat = $9, total_ttc = $10, updated_at = CURRENT_TIMESTAMP
      WHERE id = $11`,
      [
        client_id, 
        date, 
        valid_until, 
        status || 'pending',
        currency_id || null,
        conditions_generales || null,
        remiseGlobale,
        totalHTApresRemise,
        totalTVA,
        totalTTC,
        id
      ]
    );
    
    // Supprimer les anciennes lignes de devis
    await client.query('DELETE FROM quote_items WHERE quote_id = $1', [id]);
    
    // Créer les nouvelles lignes de devis
    if (items && Array.isArray(items) && items.length > 0) {
      for (const item of items) {
        const qty = parseFloat(item.quantity) || 0;
        let prixHT = parseFloat(item.unit_price) || 0;
        const discount = parseFloat(item.discount_percent) || 0;
        const tva = parseFloat(item.vat_rate) || 0;
        const exchangeRate = parseFloat(item.exchange_rate) || 1.0;
        const productCurrencyId = item.product_currency_id || null;
        
        // Convertir le prix dans la devise du devis
        prixHT = prixHT * exchangeRate;
        
        const totalLigneAvantRemise = qty * prixHT;
        const montantRemise = (totalLigneAvantRemise * discount) / 100;
        const totalLigneHT = totalLigneAvantRemise - montantRemise;
        const montantTVA = (totalLigneHT * tva) / 100;
        const totalLigneTTC = totalLigneHT + montantTVA;
        
        await client.query(
          `INSERT INTO quote_items (
            quote_id, product_id, product_name, quantity, unit_price, 
            vat_rate, discount_percent, total_ht, total_vat, total_ttc,
            product_currency_id, exchange_rate
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            id,
            item.product_id || null,
            item.product_name || '',
            qty,
            prixHT,
            tva,
            discount,
            totalLigneHT,
            montantTVA,
            totalLigneTTC,
            productCurrencyId,
            exchangeRate
          ]
        );
      }
    }
    
    await client.query('COMMIT');
    
    // Récupérer le devis complet mis à jour
    const quoteWithClient = await pool.query(`
      SELECT q.*, c.name as client_name, c.email as client_email,
             curr.code as currency_code, curr.symbol as currency_symbol
      FROM quotes q
      LEFT JOIN clients c ON q.client_id = c.id
      LEFT JOIN currencies curr ON q.currency_id = curr.id
      WHERE q.id = $1
    `, [id]);
    
    // Récupérer les lignes de devis
    const itemsResult = await pool.query(
      'SELECT * FROM quote_items WHERE quote_id = $1 ORDER BY id',
      [id]
    );
    
    res.json({
      ...quoteWithClient.rows[0],
      items: itemsResult.rows
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erreur modification devis:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

app.delete('/api/quotes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Vérifier que le devis existe
    const existingQuote = await pool.query('SELECT id FROM quotes WHERE id = $1', [id]);
    if (existingQuote.rows.length === 0) {
      return res.status(404).json({ error: 'Devis non trouvé' });
    }
    
    // Supprimer le devis (les lignes seront supprimées automatiquement grâce à ON DELETE CASCADE)
    await pool.query('DELETE FROM quotes WHERE id = $1', [id]);
    
    res.json({ message: 'Devis supprimé avec succès' });
  } catch (error) {
    console.error('Erreur suppression devis:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/quotes/:id/send-email', async (req, res) => {
  try {
    const { id } = req.params;
    const { recipientEmail } = req.body;
    
    // Récupérer le devis avec toutes ses informations
    const quoteResult = await pool.query(`
      SELECT q.*, c.name as client_name, c.email as client_email,
             curr.code as currency_code, curr.symbol as currency_symbol
      FROM quotes q
      LEFT JOIN clients c ON q.client_id = c.id
      LEFT JOIN currencies curr ON q.currency_id = curr.id
      WHERE q.id = $1
    `, [id]);
    
    if (quoteResult.rows.length === 0) {
      return res.status(404).json({ error: 'Devis non trouvé' });
    }
    
    const quote = quoteResult.rows[0];
    
    // Récupérer les lignes de devis
    const itemsResult = await pool.query(
      'SELECT * FROM quote_items WHERE quote_id = $1 ORDER BY id',
      [id]
    );
    
    // Récupérer la configuration SMTP
    const smtpResult = await pool.query('SELECT * FROM app_config WHERE config_key LIKE \'smtp_%\'');
    const smtpConfig = {};
    smtpResult.rows.forEach(row => {
      const key = row.config_key.replace('smtp_', '');
      smtpConfig[key] = row.config_value;
    });
    
    if (!smtpConfig.server || !smtpConfig.port || !smtpConfig.user || !smtpConfig.password) {
      return res.status(400).json({ error: 'Configuration SMTP incomplète' });
    }
    
    // Créer le transporteur email
    const transporter = nodemailer.createTransport({
      host: smtpConfig.server,
      port: parseInt(smtpConfig.port),
      secure: smtpConfig.secure === 'true',
      auth: {
        user: smtpConfig.user,
        pass: smtpConfig.password
      }
    });
    
    // Construire le HTML du devis
    let itemsHTML = '';
    itemsResult.rows.forEach(item => {
      itemsHTML += `
        <tr>
          <td style="padding: 8px; border-bottom: 1px solid #ddd;">${item.product_name || '-'}</td>
          <td style="padding: 8px; border-bottom: 1px solid #ddd; text-align: right;">${item.quantity}</td>
          <td style="padding: 8px; border-bottom: 1px solid #ddd; text-align: right;">${Number(item.unit_price).toFixed(2)} ${quote.currency_symbol || '€'}</td>
          <td style="padding: 8px; border-bottom: 1px solid #ddd; text-align: right;">${item.vat_rate}%</td>
          <td style="padding: 8px; border-bottom: 1px solid #ddd; text-align: right;">${Number(item.total_ht).toFixed(2)} ${quote.currency_symbol || '€'}</td>
        </tr>
      `;
    });
    
    const emailHTML = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .header { background-color: #f8f9fa; padding: 20px; border-radius: 5px; margin-bottom: 20px; }
          .info { margin-bottom: 15px; }
          .info strong { display: inline-block; width: 150px; }
          table { width: 100%; border-collapse: collapse; margin: 20px 0; }
          th { background-color: #f8f9fa; padding: 12px; text-align: left; border-bottom: 2px solid #ddd; }
          .totals { margin-top: 20px; text-align: right; }
          .total-ttc { font-size: 1.5em; font-weight: bold; margin-top: 10px; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>Devis ${quote.quote_number}</h1>
        </div>
        
        <div class="info">
          <strong>Client:</strong> ${quote.client_name || '-'}<br>
          <strong>Date:</strong> ${quote.date ? new Date(quote.date).toLocaleDateString() : '-'}<br>
          <strong>Valide jusqu'au:</strong> ${quote.valid_until ? new Date(quote.valid_until).toLocaleDateString() : '-'}<br>
          <strong>Statut:</strong> ${quote.status || 'pending'}
        </div>
        
        <table>
          <thead>
            <tr>
              <th>Produit</th>
              <th style="text-align: right;">Quantité</th>
              <th style="text-align: right;">Prix HT</th>
              <th style="text-align: right;">TVA</th>
              <th style="text-align: right;">Total HT</th>
            </tr>
          </thead>
          <tbody>
            ${itemsHTML}
          </tbody>
        </table>
        
        <div class="totals">
          <div>Total HT: ${Number(quote.total_ht || 0).toFixed(2)} ${quote.currency_symbol || '€'}</div>
          <div>Total TVA: ${Number(quote.total_vat || 0).toFixed(2)} ${quote.currency_symbol || '€'}</div>
          <div class="total-ttc">Total TTC: ${Number(quote.total_ttc || 0).toFixed(2)} ${quote.currency_symbol || '€'}</div>
        </div>
        
        ${quote.conditions_generales ? `<div style="margin-top: 30px;"><strong>Conditions Générales:</strong><br>${quote.conditions_generales.replace(/\n/g, '<br>')}</div>` : ''}
      </body>
      </html>
    `;
    
    // Envoyer l'email
    const mailOptions = {
      from: `"${smtpConfig.sender_name || 'Gestion Commerciale'}" <${smtpConfig.sender_email || smtpConfig.user}>`,
      to: recipientEmail,
      subject: `Devis ${quote.quote_number}`,
      html: emailHTML,
      text: `Devis ${quote.quote_number}\n\nClient: ${quote.client_name || '-'}\nDate: ${quote.date || '-'}\nTotal TTC: ${Number(quote.total_ttc || 0).toFixed(2)} ${quote.currency_symbol || '€'}`
    };
    
    await transporter.sendMail(mailOptions);
    
    res.json({ message: 'Devis envoyé par email avec succès' });
  } catch (error) {
    console.error('Erreur envoi email:', error);
    res.status(500).json({ error: 'Erreur lors de l\'envoi de l\'email: ' + error.message });
  }
});

// ==================== ROUTES PIÈCES JOINTES ====================
app.post('/api/quotes/:id/attachments', upload.array('files', 10), async (req, res) => {
  try {
    const { id } = req.params;
    
    // Vérifier que le devis existe
    const existingQuote = await pool.query('SELECT id FROM quotes WHERE id = $1', [id]);
    if (existingQuote.rows.length === 0) {
      return res.status(404).json({ error: 'Devis non trouvé' });
    }
    
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'Aucun fichier fourni' });
    }
    
    const attachments = [];
    
    for (const file of req.files) {
      const result = await pool.query(
        `INSERT INTO quote_attachments (quote_id, filename, original_filename, file_path, file_size, mime_type)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [
          id,
          file.filename,
          file.originalname,
          file.path,
          file.size,
          file.mimetype
        ]
      );
      attachments.push(result.rows[0]);
    }
    
    res.status(201).json(attachments);
  } catch (error) {
    console.error('Erreur upload pièce jointe:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.get('/api/quotes/:id/attachments', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(
      'SELECT * FROM quote_attachments WHERE quote_id = $1 ORDER BY created_at DESC',
      [id]
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('Erreur récupération pièces jointes:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.get('/api/quotes/:id/attachments/:attachmentId/download', async (req, res) => {
  try {
    const { id, attachmentId } = req.params;
    
    const result = await pool.query(
      'SELECT * FROM quote_attachments WHERE id = $1 AND quote_id = $2',
      [attachmentId, id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Pièce jointe non trouvée' });
    }
    
    const attachment = result.rows[0];
    
    if (!fs.existsSync(attachment.file_path)) {
      return res.status(404).json({ error: 'Fichier non trouvé sur le serveur' });
    }
    
    // Définir les en-têtes appropriés pour la visualisation
    if (attachment.mime_type) {
      res.setHeader('Content-Type', attachment.mime_type);
    }
    
    // Pour les images et PDFs, permettre la visualisation inline
    if (attachment.mime_type && (
      attachment.mime_type.startsWith('image/') || 
      attachment.mime_type === 'application/pdf' ||
      attachment.mime_type.startsWith('text/')
    )) {
      res.setHeader('Content-Disposition', `inline; filename="${attachment.original_filename}"`);
    } else {
      res.setHeader('Content-Disposition', `attachment; filename="${attachment.original_filename}"`);
    }
    
    // Envoyer le fichier
    res.sendFile(path.resolve(attachment.file_path), (err) => {
      if (err) {
        console.error('Erreur envoi fichier:', err);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Erreur lors de l\'envoi du fichier' });
        }
      }
    });
  } catch (error) {
    console.error('Erreur téléchargement pièce jointe:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ==================== ROUTES COMMENTAIRES ====================
app.post('/api/quotes/:id/comments', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId, assignedToUserId, comment } = req.body;
    
    // Vérifier que le devis existe
    const quoteCheck = await pool.query('SELECT id FROM quotes WHERE id = $1', [id]);
    if (quoteCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Devis non trouvé' });
    }
    
    // Créer le commentaire
    const result = await pool.query(
      `INSERT INTO quote_comments (quote_id, user_id, assigned_to_user_id, comment)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [id, userId, assignedToUserId || null, comment]
    );
    
    const newComment = result.rows[0];
    
    // Si un utilisateur est assigné, créer une notification et envoyer un email
    if (assignedToUserId) {
      // Récupérer les informations du devis pour la notification
      const quoteInfo = await pool.query(
        'SELECT quote_number, client_id FROM quotes WHERE id = $1',
        [id]
      );
      
      // Récupérer les informations de l'utilisateur assigné
      const assignedUser = await pool.query(
        'SELECT email, name FROM users WHERE id = $1',
        [assignedToUserId]
      );
      
      if (assignedUser.rows.length > 0) {
        // Créer la notification
        await pool.query(
          `INSERT INTO notifications (user_id, quote_id, comment_id, type, message)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            assignedToUserId,
            id,
            newComment.id,
            'comment_assigned',
            `Un nouveau commentaire vous a été assigné sur le devis ${quoteInfo.rows[0].quote_number}`
          ]
        );
        
        // Envoyer un email de notification (si SMTP configuré)
        try {
          const smtpResult = await pool.query('SELECT * FROM app_config WHERE config_key LIKE \'smtp_%\'');
          const smtpConfig = {};
          smtpResult.rows.forEach(row => {
            const key = row.config_key.replace('smtp_', '');
            smtpConfig[key] = row.config_value;
          });
          
          if (smtpConfig.server && smtpConfig.port && smtpConfig.user && smtpConfig.password) {
            const transporter = nodemailer.createTransport({
              host: smtpConfig.server,
              port: parseInt(smtpConfig.port),
              secure: smtpConfig.secure === 'true',
              auth: {
                user: smtpConfig.user,
                pass: smtpConfig.password
              }
            });
            
            const userInfo = await pool.query('SELECT name FROM users WHERE id = $1', [userId]);
            const userName = userInfo.rows[0]?.name || 'Un utilisateur';
            
            await transporter.sendMail({
              from: `"${smtpConfig.sender_name || 'Gestion Commerciale'}" <${smtpConfig.sender_email || smtpConfig.user}>`,
              to: assignedUser.rows[0].email,
              subject: `Nouveau commentaire sur le devis ${quoteInfo.rows[0].quote_number}`,
              html: `
                <h2>Nouveau commentaire assigné</h2>
                <p>Bonjour ${assignedUser.rows[0].name},</p>
                <p>${userName} vous a assigné un commentaire sur le devis <strong>${quoteInfo.rows[0].quote_number}</strong>.</p>
                <p><strong>Commentaire :</strong></p>
                <p>${comment}</p>
                <p><a href="${process.env.FRONTEND_URL || 'http://localhost:3001'}/quotes/${id}">Voir le devis</a></p>
              `,
              text: `Bonjour ${assignedUser.rows[0].name},\n\n${userName} vous a assigné un commentaire sur le devis ${quoteInfo.rows[0].quote_number}.\n\nCommentaire : ${comment}\n\nVoir le devis : ${process.env.FRONTEND_URL || 'http://localhost:3001'}/quotes/${id}`
            });
          }
        } catch (emailError) {
          console.error('Erreur envoi email notification:', emailError);
          // On continue même si l'email échoue
        }
      }
    }
    
    // Récupérer le commentaire avec les informations des utilisateurs
    const commentWithUsers = await pool.query(`
      SELECT 
        qc.*,
        u.name as user_name,
        u.email as user_email,
        atu.name as assigned_to_name,
        atu.email as assigned_to_email
      FROM quote_comments qc
      LEFT JOIN users u ON qc.user_id = u.id
      LEFT JOIN users atu ON qc.assigned_to_user_id = atu.id
      WHERE qc.id = $1
    `, [newComment.id]);
    
    res.status(201).json(commentWithUsers.rows[0]);
  } catch (error) {
    console.error('Erreur création commentaire:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ==================== ROUTES NOTIFICATIONS ====================
app.get('/api/notifications', async (req, res) => {
  try {
    const { userId } = req.query;
    
    if (!userId) {
      return res.status(400).json({ error: 'ID utilisateur requis' });
    }
    
    const result = await pool.query(`
      SELECT 
        n.*,
        q.quote_number,
        qc.comment
      FROM notifications n
      LEFT JOIN quotes q ON n.quote_id = q.id
      LEFT JOIN quote_comments qc ON n.comment_id = qc.id
      WHERE n.user_id = $1
      ORDER BY n.created_at DESC
      LIMIT 50
    `, [userId]);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Erreur récupération notifications:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.put('/api/notifications/:id/read', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(
      'UPDATE notifications SET read = TRUE WHERE id = $1 RETURNING *',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Notification non trouvée' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Erreur mise à jour notification:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.get('/api/notifications/unread-count', async (req, res) => {
  try {
    const { userId } = req.query;
    
    if (!userId) {
      return res.status(400).json({ error: 'ID utilisateur requis' });
    }
    
    const result = await pool.query(
      'SELECT COUNT(*) as count FROM notifications WHERE user_id = $1 AND read = FALSE',
      [userId]
    );
    
    res.json({ count: parseInt(result.rows[0].count) });
  } catch (error) {
    console.error('Erreur comptage notifications:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Route pour supprimer une notification
app.delete('/api/notifications/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(
      'DELETE FROM notifications WHERE id = $1 RETURNING *',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Notification non trouvée' });
    }
    
    res.json({ message: 'Notification supprimée avec succès' });
  } catch (error) {
    console.error('Erreur suppression notification:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.delete('/api/quotes/:id/attachments/:attachmentId', async (req, res) => {
  try {
    const { id, attachmentId } = req.params;
    
    const result = await pool.query(
      'SELECT * FROM quote_attachments WHERE id = $1 AND quote_id = $2',
      [attachmentId, id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Pièce jointe non trouvée' });
    }
    
    const attachment = result.rows[0];
    
    // Supprimer le fichier du système de fichiers
    if (fs.existsSync(attachment.file_path)) {
      fs.unlinkSync(attachment.file_path);
    }
    
    // Supprimer l'enregistrement de la base de données
    await pool.query('DELETE FROM quote_attachments WHERE id = $1', [attachmentId]);
    
    res.json({ message: 'Pièce jointe supprimée avec succès' });
  } catch (error) {
    console.error('Erreur suppression pièce jointe:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ==================== ROUTES CONFIGURATION ====================
app.get('/api/config/categories', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM categories ORDER BY name');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/config/categories', async (req, res) => {
  try {
    const { name, description } = req.body;
    const result = await pool.query(
      'INSERT INTO categories (name, description) VALUES ($1, $2) RETURNING *',
      [name, description || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Erreur création catégorie:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.put('/api/config/categories/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;
    const result = await pool.query(
      'UPDATE categories SET name = $1, description = $2 WHERE id = $3 RETURNING *',
      [name, description || null, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Catégorie non trouvée' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Erreur modification catégorie:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.delete('/api/config/categories/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM categories WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Catégorie non trouvée' });
    }
    res.json({ message: 'Catégorie supprimée avec succès' });
  } catch (error) {
    console.error('Erreur suppression catégorie:', error);
    // Vérifier si c'est une contrainte de clé étrangère
    if (error.code === '23503') {
      return res.status(400).json({ error: 'Impossible de supprimer : cette catégorie est utilisée par des produits' });
    }
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.get('/api/config/currencies', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM currencies ORDER BY name');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/config/currencies', async (req, res) => {
  try {
    const { code, name, symbol, decimals } = req.body;
    const result = await pool.query(
      'INSERT INTO currencies (code, name, symbol, decimals) VALUES ($1, $2, $3, $4) RETURNING *',
      [code, name, symbol, decimals || 2]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Erreur création devise:', error);
    if (error.code === '23505') {
      return res.status(400).json({ error: 'Ce code de devise existe déjà' });
    }
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.put('/api/config/currencies/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { code, name, symbol, decimals } = req.body;
    const result = await pool.query(
      'UPDATE currencies SET code = $1, name = $2, symbol = $3, decimals = $4 WHERE id = $5 RETURNING *',
      [code, name, symbol, decimals || 2, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Devise non trouvée' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Erreur modification devise:', error);
    if (error.code === '23505') {
      return res.status(400).json({ error: 'Ce code de devise existe déjà' });
    }
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.delete('/api/config/currencies/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM currencies WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Devise non trouvée' });
    }
    res.json({ message: 'Devise supprimée avec succès' });
  } catch (error) {
    console.error('Erreur suppression devise:', error);
    // Vérifier si c'est une contrainte de clé étrangère
    if (error.code === '23503') {
      return res.status(400).json({ error: 'Impossible de supprimer : cette devise est utilisée par des produits' });
    }
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.get('/api/config/vat-rates', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM vat_rates ORDER BY rate');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/config/vat-rates', async (req, res) => {
  try {
    const { rate, label } = req.body;
    const result = await pool.query(
      'INSERT INTO vat_rates (rate, label) VALUES ($1, $2) RETURNING *',
      [rate, label]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Erreur création taux TVA:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.put('/api/config/vat-rates/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { rate, label } = req.body;
    const result = await pool.query(
      'UPDATE vat_rates SET rate = $1, label = $2 WHERE id = $3 RETURNING *',
      [rate, label, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Taux de TVA non trouvé' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Erreur modification taux TVA:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.delete('/api/config/vat-rates/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM vat_rates WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Taux de TVA non trouvé' });
    }
    res.json({ message: 'Taux de TVA supprimé avec succès' });
  } catch (error) {
    console.error('Erreur suppression taux TVA:', error);
    // Vérifier si c'est une contrainte de clé étrangère
    if (error.code === '23503') {
      return res.status(400).json({ error: 'Impossible de supprimer : ce taux de TVA est utilisé par des produits' });
    }
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.get('/api/config/smtp', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM app_config WHERE config_key LIKE \'smtp_%\'');
    const config = {};
    result.rows.forEach(row => {
      // Retirer le préfixe 'smtp_' pour simplifier
      const key = row.config_key.replace('smtp_', '');
      config[key] = row.config_value;
    });
    res.json(config);
  } catch (error) {
    console.error('Erreur récupération config SMTP:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/config/smtp', async (req, res) => {
  try {
    const { server, port, secure, user, password, sender_email, sender_name } = req.body;
    
    const configs = [
      { key: 'smtp_server', value: server },
      { key: 'smtp_port', value: port?.toString() },
      { key: 'smtp_secure', value: secure ? 'true' : 'false' },
      { key: 'smtp_user', value: user },
      { key: 'smtp_password', value: password },
      { key: 'smtp_sender_email', value: sender_email },
      { key: 'smtp_sender_name', value: sender_name }
    ];

    for (const config of configs) {
      await pool.query(
        `INSERT INTO app_config (config_key, config_value, updated_at) 
         VALUES ($1, $2, CURRENT_TIMESTAMP)
         ON CONFLICT (config_key) 
         DO UPDATE SET config_value = $2, updated_at = CURRENT_TIMESTAMP`,
        [config.key, config.value]
      );
    }
    
    res.json({ message: 'Configuration SMTP enregistrée avec succès' });
  } catch (error) {
    console.error('Erreur sauvegarde config SMTP:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/config/smtp/test', async (req, res) => {
  try {
    const { server, port, secure, user, password } = req.body;
    
    // Récupérer la configuration depuis la base si non fournie
    let smtpConfig = { server, port, secure, user, password };
    if (!server) {
      const result = await pool.query('SELECT * FROM app_config WHERE config_key LIKE \'smtp_%\'');
      const config = {};
      result.rows.forEach(row => {
        const key = row.config_key.replace('smtp_', '');
        config[key] = row.config_value;
      });
      smtpConfig = {
        server: config.server,
        port: parseInt(config.port),
        secure: config.secure === 'true',
        user: config.user,
        password: config.password
      };
    }

    // Test de connexion SMTP simple (vérification des paramètres)
    if (!smtpConfig.server || !smtpConfig.port || !smtpConfig.user || !smtpConfig.password) {
      return res.status(400).json({ error: 'Paramètres SMTP incomplets' });
    }

    // Pour un vrai test, on pourrait utiliser nodemailer, mais pour l'instant on valide juste les paramètres
    res.json({ 
      success: true, 
      message: 'Paramètres SMTP valides. Note: Pour un test complet, installez nodemailer.' 
    });
  } catch (error) {
    console.error('Erreur test SMTP:', error);
    res.status(500).json({ error: 'Erreur lors du test de connexion' });
  }
});

// ==================== ROUTES STATISTIQUES ====================
app.get('/api/stats/dashboard', async (req, res) => {
  try {
    const clients = await pool.query('SELECT COUNT(*) FROM clients');
    const products = await pool.query('SELECT COUNT(*) FROM products');
    const quotes = await pool.query('SELECT COUNT(*) FROM quotes WHERE status = \'pending\'');
    const revenue = await pool.query('SELECT COALESCE(SUM(total_ttc), 0) as total FROM quotes WHERE status = \'accepted\' AND EXTRACT(MONTH FROM date) = EXTRACT(MONTH FROM CURRENT_DATE) AND EXTRACT(YEAR FROM date) = EXTRACT(YEAR FROM CURRENT_DATE)');
    
    // Statistiques par statut pour le dernier mois (30 derniers jours)
    const quotesByStatus = await pool.query(`
      SELECT 
        status,
        COUNT(*) as count,
        COALESCE(SUM(total_ttc), 0) as total_amount
      FROM quotes
      WHERE date >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY status
      ORDER BY status
    `);
    
    res.json({
      clients: parseInt(clients.rows[0].count),
      products: parseInt(products.rows[0].count),
      quotes_pending: parseInt(quotes.rows[0].count),
      revenue: parseFloat(revenue.rows[0].total),
      quotes_by_status: quotesByStatus.rows.map(row => ({
        status: row.status,
        count: parseInt(row.count),
        total_amount: parseFloat(row.total_amount)
      }))
    });
  } catch (error) {
    console.error('Erreur stats:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Endpoint pour obtenir les montants totaux des devis par statut avec filtres de date
app.get('/api/stats/activity', async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    
    let query = `
      SELECT 
        status,
        COUNT(*) as count,
        COALESCE(SUM(total_ttc), 0) as total_amount
      FROM quotes
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;
    
    if (start_date) {
      query += ` AND date >= $${paramIndex}`;
      params.push(start_date);
      paramIndex++;
    }
    
    if (end_date) {
      query += ` AND date <= $${paramIndex}`;
      params.push(end_date);
      paramIndex++;
    }
    
    query += ` GROUP BY status ORDER BY status`;
    
    const result = await pool.query(query, params);
    
    res.json({
      quotes_by_status: result.rows.map(row => ({
        status: row.status,
        count: parseInt(row.count),
        total_amount: parseFloat(row.total_amount)
      }))
    });
  } catch (error) {
    console.error('Erreur stats activité:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Gestion des erreurs 404
app.use((req, res) => {
  res.status(404).json({ error: 'Route non trouvée' });
});

// Démarrage du serveur
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Serveur démarré sur le port ${PORT}`);
  console.log(`📍 API disponible sur http://localhost:${PORT}/api`);
});

// Gestion propre de l'arrêt
process.on('SIGTERM', () => {
  console.log('SIGTERM reçu, fermeture du serveur...');
  pool.end();
  process.exit(0);
});
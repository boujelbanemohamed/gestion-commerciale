# 🏢 Application de Gestion Commerciale

Application web complète de gestion commerciale avec Node.js, React et PostgreSQL, entièrement dockerisée.

## 📋 Fonctionnalités

- ✅ **Authentification** : Connexion sécurisée
- 👥 **Gestion des clients** : CRUD complet des clients
- 📦 **Gestion des produits** : Catalogue de produits avec catégories
- 📄 **Gestion des devis** : Création et suivi des devis
- ⚙️ **Configuration** : Devises, TVA, catégories
- 📊 **Dashboard** : Vue d'ensemble des statistiques
- 🌓 **Mode sombre** : Interface avec thème clair/sombre

## 🏗️ Architecture

```
gestion-commerciale/
├── docker-compose.yml          # Orchestration des services
├── init.sql                    # Script d'initialisation PostgreSQL
├── backend/                    # API Node.js/Express
│   ├── Dockerfile
│   ├── package.json
│   └── server.js
└── frontend/                   # Application React
    ├── Dockerfile
    ├── package.json
    └── src/
        └── App.js
```

## 🚀 Installation et Démarrage

### Prérequis

- Docker Desktop installé
- Docker Compose installé
- Ports disponibles : 3000, 5000, 5432

### Étape 1 : Cloner ou créer le projet

```bash
# Créer la structure du projet
mkdir gestion-commerciale
cd gestion-commerciale
```

### Étape 2 : Créer les fichiers

Créez tous les fichiers fournis dans l'arborescence suivante :

```
gestion-commerciale/
├── docker-compose.yml
├── init.sql
├── backend/
│   ├── Dockerfile
│   ├── package.json
│   └── server.js
└── frontend/
    ├── Dockerfile
    ├── package.json
    ├── public/
    │   └── index.html
    └── src/
        ├── index.js
        └── App.js
```

### Étape 3 : Créer les fichiers manquants du frontend

**frontend/public/index.html** :
```html
<!DOCTYPE html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Gestion Commerciale</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
      tailwind.config = {
        darkMode: 'class',
      }
    </script>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
```

**frontend/src/index.js** :
```javascript
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

### Étape 4 : Démarrer l'application

```bash
# Construire et démarrer tous les services
docker-compose up --build

# Ou en arrière-plan
docker-compose up -d --build
```

### Étape 5 : Accéder à l'application

- **Frontend** : http://localhost:3000
- **API Backend** : http://localhost:5000/api
- **PostgreSQL** : localhost:5432

### Identifiants de connexion

- **Email** : admin@demo.com
- **Mot de passe** : admin123

## 🛠️ Commandes utiles

```bash
# Voir les logs
docker-compose logs -f

# Arrêter les services
docker-compose down

# Arrêter et supprimer les volumes (⚠️ supprime les données)
docker-compose down -v

# Reconstruire un service spécifique
docker-compose up --build backend

# Accéder à la base de données
docker exec -it gestion_db psql -U admin -d gestion_commerciale

# Redémarrer un service
docker-compose restart backend
```

## 📊 Données de test

L'application est pré-remplie avec des données de démonstration :

- **Clients** : 3 clients (Alice Martin, Bob Dupont, Carla Moreau)
- **Produits** : 3 produits avec prix et TVA
- **Catégories** : Électronique, Informatique, Accessoires, etc.
- **Devises** : EUR, USD, TND, GBP
- **Taux de TVA** : 7%, 19%, 20%

## 🔌 API Endpoints

### Authentification
- `POST /api/auth/login` - Connexion

### Clients
- `GET /api/clients` - Liste des clients
- `GET /api/clients/:id` - Détails d'un client
- `POST /api/clients` - Créer un client
- `PUT /api/clients/:id` - Modifier un client
- `DELETE /api/clients/:id` - Supprimer un client

### Produits
- `GET /api/products` - Liste des produits
- `POST /api/products` - Créer un produit
- `DELETE /api/products/:id` - Supprimer un produit

### Devis
- `GET /api/quotes` - Liste des devis
- `GET /api/quotes/:id` - Détails d'un devis

### Configuration
- `GET /api/config/categories` - Liste des catégories
- `GET /api/config/currencies` - Liste des devises
- `GET /api/config/vat-rates` - Liste des taux de TVA
- `GET /api/config/smtp` - Configuration SMTP

### Statistiques
- `GET /api/stats/dashboard` - Statistiques du dashboard

## 🗄️ Base de données

### Tables principales

- `users` - Utilisateurs
- `clients` - Clients
- `products` - Produits
- `categories` - Catégories de produits
- `currencies` - Devises
- `vat_rates` - Taux de TVA
- `quotes` - Devis
- `quote_items` - Lignes de devis
- `app_config` - Configuration de l'application

### Accéder à PostgreSQL

```bash
# Via Docker
docker exec -it gestion_db psql -U admin -d gestion_commerciale

# Commandes SQL utiles
\dt                    # Lister les tables
\d clients            # Décrire la table clients
SELECT * FROM clients; # Voir les clients
```

## 🎨 Personnalisation

### Modifier les couleurs

Dans `frontend/src/App.js`, les couleurs sont définies via Tailwind CSS :
- Bleu primaire : `bg-blue-600`
- Rouge : `bg-red-600`
- Vert : `bg-green-600`

### Ajouter de nouvelles fonctionnalités

1. **Backend** : Ajouter les routes dans `backend/server.js`
2. **Frontend** : Créer de nouveaux composants dans `App.js`
3. **Base de données** : Modifier `init.sql` pour ajouter des tables

## 🐛 Dépannage

### Le frontend ne charge pas

```bash
# Vérifier les logs
docker-compose logs frontend

# Reconstruire le frontend
docker-compose up --build frontend
```

### Erreur de connexion à la base de données

```bash
# Vérifier que PostgreSQL est démarré
docker-compose ps

# Redémarrer PostgreSQL
docker-compose restart postgres

# Vérifier les logs
docker-compose logs postgres
```

### Erreur "Port already in use"

```bash
# Trouver le processus utilisant le port
lsof -i :3000  # ou :5000 ou :5432

# Modifier les ports dans docker-compose.yml si nécessaire
```

### Réinitialiser complètement l'application

```bash
# Arrêter tous les services et supprimer les volumes
docker-compose down -v

# Supprimer les images
docker-compose down --rmi all

# Redémarrer
docker-compose up --build
```

## 📝 TODO / Améliorations futures

- [ ] Ajouter la création/modification de clients depuis l'UI
- [ ] Ajouter la création/modification de produits depuis l'UI
- [ ] Implémenter la création complète de devis
- [ ] Ajouter l'export PDF des devis
- [ ] Implémenter l'envoi d'emails via SMTP
- [ ] Ajouter la gestion des utilisateurs
- [ ] Implémenter l'authentification JWT complète
- [ ] Ajouter des graphiques plus détaillés au dashboard
- [ ] Ajouter la recherche et les filtres
- [ ] Implémenter la pagination

## 🔒 Sécurité

⚠️ **IMPORTANT** : Cette application est un prototype de démonstration.

Pour une utilisation en production :
- Changez tous les mots de passe
- Utilisez des variables d'environnement sécurisées
- Implémentez une vraie authentification JWT
- Ajoutez HTTPS
- Utilisez bcrypt pour hasher les mots de passe
- Ajoutez des validations côté serveur
- Implémentez des limites de taux (rate limiting)

## 📄 Licence

MIT

## 👨‍💻 Auteur

Projet créé avec Claude AI

---

**Bon développement ! 🚀**
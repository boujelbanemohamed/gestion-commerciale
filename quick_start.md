# 🚀 Guide de Démarrage Rapide

## En 5 minutes ⏱️

### 1️⃣ Créer la structure

```bash
mkdir gestion-commerciale && cd gestion-commerciale
mkdir -p backend frontend/src frontend/public
```

### 2️⃣ Copier les fichiers

Copiez tous les fichiers fournis dans leur emplacement respectif :

```
gestion-commerciale/
├── docker-compose.yml        ← À la racine
├── init.sql                  ← À la racine
├── backend/
│   ├── Dockerfile
│   ├── package.json
│   └── server.js
└── frontend/
    ├── Dockerfile
    ├── package.json
    ├── public/
    │   └── index.html       ← Créer ce fichier (voir ci-dessous)
    └── src/
        ├── index.js         ← Créer ce fichier (voir ci-dessous)
        └── App.js
```

### 3️⃣ Créer frontend/public/index.html

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

### 4️⃣ Créer frontend/src/index.js

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

### 5️⃣ Lancer l'application

```bash
docker-compose up --build
```

### 6️⃣ Se connecter

Ouvrez http://localhost:3000 et connectez-vous avec :

- **Email** : `admin@demo.com`
- **Mot de passe** : `admin123`

---

## ✅ Checklist de vérification

Avant de lancer `docker-compose up`, vérifiez que vous avez :

- [ ] Tous les fichiers dans la bonne structure
- [ ] Docker Desktop démarré
- [ ] Ports 3000, 5000, 5432 disponibles
- [ ] Les fichiers `index.html` et `index.js` créés

---

## 🎯 Premiers pas

Une fois connecté :

1. **Explorez le Dashboard** 📊
   - Voir les statistiques en temps réel
   - Nombre de clients, produits, devis

2. **Consultez les Clients** 👥
   - 3 clients de démonstration pré-créés
   - Testez la suppression d'un client

3. **Parcourez les Produits** 📦
   - 3 produits avec prix HT et TTC
   - Voir les catégories et la TVA

4. **Allez dans Configuration** ⚙️
   - Voir les devises disponibles
   - Consulter les taux de TVA
   - Explorer les catégories

5. **Testez le mode sombre** 🌓
   - Cliquez sur le bouton en bas du menu

---

## 🆘 Problème ?

### Le frontend ne se lance pas

```bash
# Vérifier les logs
docker-compose logs frontend

# Reconstruire
docker-compose down
docker-compose up --build
```

### Erreur "Cannot connect to backend"

```bash
# Vérifier que le backend tourne
docker-compose ps

# Voir les logs du backend
docker-compose logs backend
```

### Base de données ne démarre pas

```bash
# Vérifier PostgreSQL
docker-compose logs postgres

# Redémarrer
docker-compose restart postgres
```

---

## 📱 URLs importantes

| Service | URL | Description |
|---------|-----|-------------|
| Frontend | http://localhost:3000 | Interface utilisateur |
| API | http://localhost:5000/api | API REST |
| PostgreSQL | localhost:5432 | Base de données |

---

## 🛑 Arrêter l'application

```bash
# Arrêter les services
docker-compose down

# Arrêter ET supprimer les données
docker-compose down -v
```

---

## 📚 Prochaines étapes

Une fois l'application lancée, consultez le **README.md** pour :

- La documentation complète de l'API
- Les commandes avancées Docker
- Les options de personnalisation
- Les informations de sécurité

---

**Bonne découverte ! 🎉**
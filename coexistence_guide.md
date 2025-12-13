# 🤝 Guide de Coexistence avec Autres Applications Docker

## 🎯 Objectif

Ce guide explique comment l'application **Gestion Commerciale** cohabite paisiblement avec d'autres applications Docker sur le même serveur RedHat.

---

## 🔍 Analyse du Serveur Existant

### Avant le Déploiement

```bash
# 1. Lister toutes les applications Docker existantes
docker ps -a

# 2. Lister tous les réseaux Docker
docker network ls

# 3. Lister tous les volumes
docker volume ls

# 4. Vérifier les ports utilisés
sudo netstat -tlnp | grep -E "LISTEN"
# ou
sudo ss -tlnp

# 5. Lister les projets docker-compose
docker ps --format "{{.Label \"com.docker.compose.project\"}}" | sort -u

# 6. Vérifier l'utilisation des ressources
docker stats --no-stream
```

### Informations à Noter

Créez un fichier d'inventaire :

```bash
cat > inventory.txt << EOF
Date: $(date)

=== PORTS UTILISÉS ===
$(sudo netstat -tlnp | grep LISTEN)

=== CONTENEURS ACTIFS ===
$(docker ps --format "table {{.Names}}\t{{.Ports}}")

=== RÉSEAUX DOCKER ===
$(docker network ls)

=== UTILISATION RESSOURCES ===
$(free -h)
$(df -h)
EOF
```

---

## 🛡️ Stratégies d'Isolation

### 1. Isolation par Ports

Notre application utilise des ports **différents** des standards :

| Service | Port Standard | Notre Port | Raison |
|---------|--------------|------------|---------|
| Frontend | 3000 | 3001 | Éviter React/Next.js apps |
| Backend | 5000 | 5001 | Éviter Flask/Express apps |
| PostgreSQL | 5432 | 5433 | Éviter autres DB PostgreSQL |

**Configuration:**
```bash
# Dans .env
FRONTEND_PORT=3001  # Modifiable si conflit
BACKEND_PORT=5001   # Modifiable si conflit
DB_PORT=5433        # Modifiable si conflit
```

---

### 2. Isolation par Réseau Docker

#### Notre Réseau Dédié

```yaml
networks:
  gestion_network:
    name: gestion_commerciale_network
    driver: bridge
    ipam:
      config:
        - subnet: 172.25.0.0/16
```

#### Vérifier les Sous-Réseaux Existants

```bash
# Lister tous les sous-réseaux utilisés
docker network inspect $(docker network ls -q) | grep Subnet

# Notre sous-réseau: 172.25.0.0/16
# Si conflit, modifier dans docker-compose.yml:
# subnet: 172.26.0.0/16  (ou 172.27, 172.28, etc.)
```

#### Résoudre un Conflit de Sous-Réseau

```yaml
# Si 172.25.0.0/16 est déjà utilisé, changer pour:
networks:
  gestion_network:
    name: gestion_commerciale_network
    driver: bridge
    ipam:
      config:
        - subnet: 172.28.0.0/16  # Changé !
```

---

### 3. Isolation par Nommage

#### Noms Uniques pour Tout

**Conteneurs:**
```yaml
container_name: gestion_commerciale_db       # Au lieu de "db"
container_name: gestion_commerciale_backend  # Au lieu de "backend"
container_name: gestion_commerciale_frontend # Au lieu de "frontend"
```

**Volumes:**
```yaml
volumes:
  gestion_postgres_data:
    name: gestion_commerciale_postgres_data  # Nom explicite
```

**Réseaux:**
```yaml
networks:
  gestion_network:
    name: gestion_commerciale_network  # Nom explicite
```

**Projet Docker Compose:**
```bash
# Dans .env
COMPOSE_PROJECT_NAME=gestion_commerciale
```

---

### 4. Isolation par Ressources

#### Limites de Ressources Définies

```yaml
deploy:
  resources:
    limits:
      cpus: '1.0'      # Maximum 1 CPU
      memory: 512M     # Maximum 512 Mo
    reservations:
      cpus: '0.5'      # Minimum garanti
      memory: 256M     # Minimum garanti
```

#### Calculer les Ressources Disponibles

```bash
# Ressources totales du serveur
echo "=== RESSOURCES TOTALES ==="
nproc  # Nombre de CPUs
free -h  # Mémoire

# Ressources utilisées par Docker
echo "=== RESSOURCES DOCKER ==="
docker stats --no-stream

# Ressources disponibles (approximatif)
echo "=== ESTIMATION DISPONIBLE ==="
# Calcul manuel basé sur les résultats ci-dessus
```

#### Ajuster les Limites si Nécessaire

```bash
# Dans .env, ajouter:
POSTGRES_MEMORY_LIMIT=256M   # Réduire si serveur surchargé
BACKEND_MEMORY_LIMIT=256M    # Réduire si serveur surchargé
FRONTEND_MEMORY_LIMIT=128M   # Réduire si serveur surchargé
```

---

## 🔌 Scénarios de Coexistence

### Scénario 1 : Avec une Autre Base de Données PostgreSQL

**Problème:** Port 5432 déjà utilisé

**Solution:**
```bash
# Dans .env
DB_PORT=5433  # Ou 5434, 5435, etc.
```

**Vérification:**
```bash
# Tester la connexion à notre DB
docker exec -it gestion_commerciale_db psql -U gestion_user -d gestion_commerciale

# L'autre DB reste accessible sur son port
psql -h localhost -p 5432 -U autre_user -d autre_db
```

---

### Scénario 2 : Avec un Frontend React/Next.js

**Problème:** Port 3000 déjà utilisé

**Solution:**
```bash
# Dans .env
FRONTEND_PORT=3001  # Ou tout autre port libre
```

**Accès:**
- Application existante : `http://serveur:3000`
- Notre application : `http://serveur:3001`

---

### Scénario 3 : Avec une API Express/Flask

**Problème:** Port 5000 déjà utilisé

**Solution:**
```bash
# Dans .env
BACKEND_PORT=5001  # Ou tout autre port libre
```

**Accès:**
- API existante : `http://serveur:5000/api`
- Notre API : `http://serveur:5001/api`

---

### Scénario 4 : Utilisation d'un Reverse Proxy Existant

**Si Nginx est déjà configuré sur le serveur:**

```nginx
# Ajouter dans /etc/nginx/conf.d/gestion.conf

# Application existante sur /
location / {
    proxy_pass http://localhost:3000;
}

# Notre application sur /gestion
location /gestion {
    proxy_pass http://localhost:3001;
    rewrite ^/gestion(.*)$ $1 break;
}

# Notre API sur /gestion/api
location /gestion/api {
    proxy_pass http://localhost:5001/api;
}
```

**Modifier le .env:**
```bash
# L'API sera accessible via le reverse proxy
REACT_APP_API_URL=http://serveur/gestion/api
```

---

### Scénario 5 : Serveur avec Plusieurs Projets Docker Compose

**Bonne Pratique:** Organisation des répertoires

```bash
/opt/
├── app1/
│   ├── docker-compose.yml
│   └── .env
├── app2/
│   ├── docker-compose.yml
│   └── .env
└── gestion-commerciale/    # Notre app
    ├── docker-compose.yml
    └── .env
```

**Commandes pour gérer plusieurs projets:**

```bash
# Depuis /opt/gestion-commerciale
docker-compose up -d

# Depuis /opt/app1
cd /opt/app1
docker-compose up -d

# Voir tous les conteneurs de tous les projets
docker ps

# Filtrer par projet
docker ps --filter "label=com.docker.compose.project=gestion_commerciale"
```

---

## 🚦 Gestion des Conflits

### Détecter un Conflit de Port

```bash
#!/bin/bash
# check_conflicts.sh

echo "🔍 Vérification des conflits potentiels..."

# Ports à vérifier
PORTS=(3001 5001 5433)

for PORT in "${PORTS[@]}"; do
    if sudo netstat -tlnp | grep -q ":$PORT "; then
        echo "❌ Conflit détecté sur le port $PORT"
        echo "   Processus utilisant ce port:"
        sudo netstat -tlnp | grep ":$PORT "
        echo ""
    else
        echo "✅ Port $PORT disponible"
    fi
done

echo ""
echo "📊 Sous-réseaux Docker utilisés:"
docker network inspect $(docker network ls -q) 2>/dev/null | grep -A 2 "Subnet" | grep -v "Gateway"

echo ""
echo "📦 Volumes Docker existants:"
docker volume ls | grep -v "DRIVER"

echo ""
echo "🏷️  Projets Docker Compose actifs:"
docker ps --format "{{.Label \"com.docker.compose.project\"}}" | sort -u | grep -v "^$"
```

### Résoudre un Conflit de Nom

```bash
# Si un conteneur "gestion_commerciale_db" existe déjà

# Option 1: Renommer l'ancien
docker rename gestion_commerciale_db gestion_commerciale_db_old

# Option 2: Changer notre nom dans docker-compose.yml
container_name: gestion_commerciale_v2_db

# Option 3: Changer le préfixe du projet dans .env
COMPOSE_PROJECT_NAME=gestion_v2
```

---

## 📊 Monitoring Multi-Applications

### Script de Surveillance Global

```bash
#!/bin/bash
# global_monitor.sh

echo "╔════════════════════════════════════════════════╗"
echo "║     ÉTAT GLOBAL DU SERVEUR DOCKER             ║"
echo "╚════════════════════════════════════════════════╝"
echo ""

echo "=== RESSOURCES SYSTÈME ==="
free -h | head -n 2
df -h | grep -E "Filesystem|/$"
echo ""

echo "=== TOUS LES CONTENEURS ==="
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | head -n 20
echo ""

echo "=== UTILISATION PAR CONTENEUR ==="
docker stats --no-stream | head -n 10
echo ""

echo "=== PROJETS DOCKER COMPOSE ==="
docker ps --format "{{.Label \"com.docker.compose.project\"}}" | sort -u | grep -v "^$"
echo ""

echo "=== RÉSEAUX ACTIFS ==="
docker network ls | grep -v "NETWORK ID"
echo ""

echo "=== ESPACE DISQUE DOCKER ==="
docker system df
```

---

## 🔧 Dépannage des Conflits

### Problème : Impossible de démarrer un conteneur

```bash
# 1. Vérifier les logs
docker-compose logs nom_service

# 2. Vérifier les conflits de port
sudo netstat -tlnp | grep PORT_NUMERO

# 3. Vérifier les conflits de nom
docker ps -a | grep nom_conteneur

# 4. Vérifier le réseau
docker network inspect gestion_commerciale_network
```

### Problème : Conteneurs de différents projets ne peuvent pas communiquer

**Par design, c'est normal !** Les réseaux sont isolés.

**Si communication nécessaire:**
```bash
# Créer un réseau partagé
docker network create shared_network

# Connecter les conteneurs au réseau partagé
docker network connect shared_network gestion_commerciale_backend
docker network connect shared_network autre_app_service
```

---

## 📋 Checklist de Coexistence

Avant de déployer notre application :

- [ ] Inventaire des ports utilisés
- [ ] Inventaire des réseaux Docker
- [ ] Inventaire des volumes Docker
- [ ] Vérification des ressources disponibles
- [ ] Choix de ports libres (3001, 5001, 5433)
- [ ] Choix d'un sous-réseau libre (172.25.0.0/16)
- [ ] Configuration du .env
- [ ] Test de conflit avec `check_conflicts.sh`
- [ ] Déploiement en mode test
- [ ] Vérification du fonctionnement
- [ ] Documentation des ports utilisés

---

## 🎯 Bonnes Pratiques

### 1. Documentation

Maintenir un fichier `SERVER_APPS.md` :

```markdown
# Applications sur ce serveur

## Gestion Commerciale
- Ports: 3001 (frontend), 5001 (backend), 5433 (db)
- Réseau: 172.25.0.0/16
- Répertoire: /opt/gestion-commerciale
- Démarrage: cd /opt/gestion-commerciale && docker-compose up -d

## Application XYZ
- Ports: 3000, 5000, 5432
- ...
```

### 2. Conventions de Nommage

- Préfixer tous les noms : `gestion_commerciale_*`
- Utiliser des ports non-standards : 3001, 5001, 5433
- Suffixer les projets compose : `_v1`, `_v2` si besoin

### 3. Limites de Ressources

- Toujours définir des limites
- Laisser 20-30% de ressources libres
- Monitorer régulièrement

### 4. Sauvegardes

- Sauvegardes indépendantes par projet
- Répertoire dédié : `/opt/backups/gestion-commerciale/`

---

**Avec cette approche, votre application cohabite harmonieusement avec toutes les autres ! 🤝**
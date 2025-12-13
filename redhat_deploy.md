# 🐧 Guide de Déploiement sur Serveur RedHat

## 📋 Prérequis

### 1. Vérifications sur le serveur RedHat

```bash
# Se connecter au serveur
ssh votre_user@serveur_redhat

# Vérifier la version RedHat
cat /etc/redhat-release

# Vérifier Docker
docker --version

# Vérifier Docker Compose
docker-compose --version

# Vérifier les ports disponibles
sudo netstat -tlnp | grep -E "3000|3001|5000|5001|5432|5433"

# Vérifier l'espace disque
df -h

# Vérifier la mémoire disponible
free -h
```

### 2. Permissions nécessaires

```bash
# Vérifier que l'utilisateur est dans le groupe docker
groups

# Si nécessaire, ajouter l'utilisateur au groupe docker
sudo usermod -aG docker $USER

# Recharger les groupes
newgrp docker

# Tester docker sans sudo
docker ps
```

---

## 🚀 Déploiement Étape par Étape

### Étape 1 : Préparation du répertoire

```bash
# Créer un répertoire dédié
sudo mkdir -p /opt/gestion-commerciale
cd /opt/gestion-commerciale

# Donner les permissions appropriées
sudo chown -R $USER:$USER /opt/gestion-commerciale
```

### Étape 2 : Transfert des fichiers

#### Option A : Via Git (Recommandé)

```bash
# Cloner le repository
git clone https://votre-repo.git .

# Ou si déjà cloné, mettre à jour
git pull origin main
```

#### Option B : Via SCP

```bash
# Depuis votre machine locale
scp -r gestion-commerciale/* user@serveur:/opt/gestion-commerciale/
```

#### Option C : Via rsync (Plus efficace)

```bash
# Depuis votre machine locale
rsync -avz --progress gestion-commerciale/ user@serveur:/opt/gestion-commerciale/
```

### Étape 3 : Configuration des variables d'environnement

```bash
cd /opt/gestion-commerciale

# Copier le fichier d'exemple
cp .env.example .env

# Éditer avec nano ou vim
nano .env
```

#### Configuration minimale requise :

```bash
# Ports (vérifier qu'ils sont libres)
FRONTEND_PORT=3001
BACKEND_PORT=5001
DB_PORT=5433

# Base de données (changer le mot de passe)
DB_PASSWORD=VotreMotDePasseSecurise!

# JWT (générer un nouveau secret)
JWT_SECRET=$(openssl rand -base64 32)

# URL API (utiliser l'IP du serveur)
REACT_APP_API_URL=http://VOTRE_IP:5001/api
```

### Étape 4 : Vérification des conflits de ports

```bash
# Créer un script de vérification
cat > check_ports.sh << 'EOF'
#!/bin/bash
echo "🔍 Vérification des ports..."
echo ""

ports=(3001 5001 5433)
all_free=true

for port in "${ports[@]}"; do
    if sudo netstat -tlnp | grep -q ":$port "; then
        echo "❌ Port $port est OCCUPÉ"
        sudo netstat -tlnp | grep ":$port"
        all_free=false
    else
        echo "✅ Port $port est LIBRE"
    fi
done

echo ""
if [ "$all_free" = true ]; then
    echo "✅ Tous les ports sont disponibles !"
    exit 0
else
    echo "❌ Certains ports sont occupés. Modifiez le fichier .env"
    exit 1
fi
EOF

chmod +x check_ports.sh
./check_ports.sh
```

### Étape 5 : Vérification des applications existantes

```bash
# Lister tous les conteneurs Docker en cours
docker ps -a

# Lister tous les réseaux Docker
docker network ls

# Vérifier les volumes Docker
docker volume ls

# Vérifier les projets docker-compose actifs
docker-compose ls 2>/dev/null || echo "Commande non disponible"
```

### Étape 6 : Construction et démarrage

```bash
# Se placer dans le répertoire
cd /opt/gestion-commerciale

# Construction des images (sans démarrer)
docker-compose build

# Vérifier les images créées
docker images | grep gestion

# Démarrer en mode détaché
docker-compose up -d

# Suivre les logs
docker-compose logs -f
```

### Étape 7 : Vérification du déploiement

```bash
# Vérifier que tous les services sont UP
docker-compose ps

# Vérifier les logs de chaque service
docker-compose logs backend_gestion
docker-compose logs frontend_gestion
docker-compose logs postgres_gestion

# Tester l'API
curl http://localhost:5001/api

# Tester le frontend (depuis le serveur)
curl -I http://localhost:3001
```

### Étape 8 : Test depuis l'extérieur

```bash
# Depuis votre machine locale
curl http://IP_SERVEUR:5001/api

# Ouvrir dans le navigateur
http://IP_SERVEUR:3001
```

---

## 🔒 Configuration du Firewall RedHat

### Avec firewalld (RedHat 7+)

```bash
# Vérifier le statut du firewall
sudo firewall-cmd --state

# Ouvrir les ports nécessaires
sudo firewall-cmd --permanent --add-port=3001/tcp  # Frontend
sudo firewall-cmd --permanent --add-port=5001/tcp  # Backend

# Recharger le firewall
sudo firewall-cmd --reload

# Vérifier les ports ouverts
sudo firewall-cmd --list-ports
```

### Avec iptables (RedHat 6 ou si firewalld désactivé)

```bash
# Ouvrir les ports
sudo iptables -A INPUT -p tcp --dport 3001 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 5001 -j ACCEPT

# Sauvegarder les règles
sudo service iptables save

# Vérifier les règles
sudo iptables -L -n
```

---

## 🔄 Configuration avec Reverse Proxy (Recommandé)

### Option A : Nginx Reverse Proxy

```bash
# Installer Nginx si nécessaire
sudo yum install nginx -y

# Créer la configuration
sudo nano /etc/nginx/conf.d/gestion-commerciale.conf
```

```nginx
# Configuration Nginx pour Gestion Commerciale
server {
    listen 80;
    server_name votre-domaine.com;  # ou l'IP du serveur

    # Frontend
    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # API Backend
    location /api {
        proxy_pass http://localhost:5001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
# Tester la configuration
sudo nginx -t

# Recharger Nginx
sudo systemctl reload nginx

# Activer au démarrage
sudo systemctl enable nginx

# Dans ce cas, modifier le .env :
# REACT_APP_API_URL=http://votre-domaine.com/api
```

### Option B : Apache Reverse Proxy

```bash
# Installer Apache et mod_proxy
sudo yum install httpd mod_ssl -y

# Activer les modules
sudo nano /etc/httpd/conf.modules.d/00-proxy.conf
```

```apache
LoadModule proxy_module modules/mod_proxy.so
LoadModule proxy_http_module modules/mod_proxy_http.so
LoadModule proxy_wstunnel_module modules/mod_proxy_wstunnel.so
```

```bash
# Créer la configuration
sudo nano /etc/httpd/conf.d/gestion-commerciale.conf
```

```apache
<VirtualHost *:80>
    ServerName votre-domaine.com

    ProxyPreserveHost On
    ProxyRequests Off

    # Frontend
    ProxyPass / http://localhost:3001/
    ProxyPassReverse / http://localhost:3001/

    # API
    ProxyPass /api http://localhost:5001/api
    ProxyPassReverse /api http://localhost:5001/api

    ErrorLog /var/log/httpd/gestion-error.log
    CustomLog /var/log/httpd/gestion-access.log combined
</VirtualHost>
```

```bash
# Tester et démarrer
sudo apachectl configtest
sudo systemctl restart httpd
sudo systemctl enable httpd
```

---

## 🔐 Sécurisation avec SSL (Let's Encrypt)

```bash
# Installer certbot
sudo yum install certbot python3-certbot-nginx -y  # Pour Nginx
# ou
sudo yum install certbot python3-certbot-apache -y  # Pour Apache

# Obtenir un certificat SSL
sudo certbot --nginx -d votre-domaine.com  # Nginx
# ou
sudo certbot --apache -d votre-domaine.com  # Apache

# Renouvellement automatique (déjà configuré par défaut)
sudo certbot renew --dry-run
```

---

## 📊 Monitoring et Logs

### Logs des conteneurs

```bash
# Tous les logs en temps réel
docker-compose logs -f

# Logs d'un service spécifique
docker-compose logs -f backend_gestion

# Dernières 100 lignes
docker-compose logs --tail=100

# Logs depuis une date
docker-compose logs --since="2024-01-01T00:00:00"
```

### Logs système

```bash
# Créer un script de monitoring
cat > /opt/gestion-commerciale/monitor.sh << 'EOF'
#!/bin/bash

echo "=== État des Services ==="
docker-compose ps

echo ""
echo "=== Utilisation CPU/Mémoire ==="
docker stats --no-stream gestion_commerciale_frontend gestion_commerciale_backend gestion_commerciale_db

echo ""
echo "=== Espace Disque ==="
df -h | grep -E "Filesystem|/opt"

echo ""
echo "=== Santé des Conteneurs ==="
docker ps --format "table {{.Names}}\t{{.Status}}" | grep gestion
EOF

chmod +x /opt/gestion-commerciale/monitor.sh
```

### Crontab pour monitoring régulier

```bash
# Éditer le crontab
crontab -e

# Ajouter une ligne pour vérifier toutes les heures
0 * * * * /opt/gestion-commerciale/monitor.sh >> /var/log/gestion-monitoring.log 2>&1
```

---

## 🔄 Mise à jour de l'Application

```bash
# Script de mise à jour
cat > /opt/gestion-commerciale/update.sh << 'EOF'
#!/bin/bash

echo "🔄 Mise à jour de l'application..."

# Sauvegarder la base de données
echo "💾 Sauvegarde de la base de données..."
docker exec gestion_commerciale_db pg_dump -U gestion_user gestion_commerciale > backup_$(date +%Y%m%d_%H%M%S).sql

# Récupérer les dernières modifications
echo "📥 Récupération des modifications..."
git pull origin main

# Reconstruire les images
echo "🔨 Reconstruction des images..."
docker-compose build

# Redémarrer les services
echo "♻️ Redémarrage des services..."
docker-compose down
docker-compose up -d

# Vérifier le statut
echo "✅ Vérification du statut..."
sleep 10
docker-compose ps

echo "✨ Mise à jour terminée !"
EOF

chmod +x /opt/gestion-commerciale/update.sh
```

---

## 🗄️ Sauvegarde et Restauration

### Sauvegarde automatique

```bash
# Créer un script de sauvegarde
cat > /opt/gestion-commerciale/backup.sh << 'EOF'
#!/bin/bash

BACKUP_DIR="/opt/gestion-commerciale/backups"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p $BACKUP_DIR

# Sauvegarde de la base de données
docker exec gestion_commerciale_db pg_dump -U gestion_user gestion_commerciale > $BACKUP_DIR/db_$DATE.sql

# Compression
gzip $BACKUP_DIR/db_$DATE.sql

# Garder seulement les 7 dernières sauvegardes
ls -t $BACKUP_DIR/db_*.sql.gz | tail -n +8 | xargs -r rm

echo "✅ Sauvegarde créée: $BACKUP_DIR/db_$DATE.sql.gz"
EOF

chmod +x /opt/gestion-commerciale/backup.sh

# Ajouter au crontab (tous les jours à 2h du matin)
(crontab -l 2>/dev/null; echo "0 2 * * * /opt/gestion-commerciale/backup.sh") | crontab -
```

### Restauration

```bash
# Restaurer depuis une sauvegarde
gunzip -c backup_20240101_020000.sql.gz | docker exec -i gestion_commerciale_db psql -U gestion_user -d gestion_commerciale
```

---

## 🛑 Arrêt et Maintenance

```bash
# Arrêt gracieux
docker-compose stop

# Arrêt et suppression des conteneurs (données préservées)
docker-compose down

# Redémarrage
docker-compose up -d

# Maintenance d'un service spécifique
docker-compose restart backend_gestion
```

---

## ⚠️ Dépannage

### Problème : Port déjà utilisé

```bash
# Identifier le processus
sudo netstat -tlnp | grep :3001

# Modifier le port dans .env
nano .env
# FRONTEND_PORT=3002

# Relancer
docker-compose down
docker-compose up -d
```

### Problème : Conteneur ne démarre pas

```bash
# Voir les logs détaillés
docker-compose logs backend_gestion

# Inspecter le conteneur
docker inspect gestion_commerciale_backend

# Redémarrer un service
docker-compose restart backend_gestion
```

### Problème : Erreur de connexion DB

```bash
# Vérifier que PostgreSQL est démarré
docker-compose ps postgres_gestion

# Tester la connexion
docker exec -it gestion_commerciale_db psql -U gestion_user -d gestion_commerciale

# Réinitialiser la base
docker-compose down -v
docker-compose up -d
```

### Problème : Conflit avec autres applications

```bash
# Lister tous les réseaux Docker
docker network ls

# Lister tous les conteneurs (même arrêtés)
docker ps -a

# Si conflit de nom, modifier COMPOSE_PROJECT_NAME dans .env
nano .env
# COMPOSE_PROJECT_NAME=gestion_v2

docker-compose down
docker-compose up -d
```

---

## 📋 Checklist de Déploiement

- [ ] Serveur RedHat accessible en SSH
- [ ] Docker et Docker Compose installés
- [ ] Permissions utilisateur configurées
- [ ] Ports 3001, 5001, 5433 disponibles
- [ ] Fichier .env créé et configuré
- [ ] Firewall configuré
- [ ] Reverse proxy configuré (optionnel)
- [ ] SSL configuré (optionnel)
- [ ] Sauvegarde automatique configurée
- [ ] Monitoring en place
- [ ] Tests de fonctionnement réussis

---

**Déploiement prêt pour production sur RedHat ! 🚀**
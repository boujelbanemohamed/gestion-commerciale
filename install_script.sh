#!/bin/bash

# ============================================
# Script d'Installation Automatique
# Application Gestion Commerciale - RedHat
# ============================================

set -e  # Arrêt en cas d'erreur

# Couleurs
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Fonctions utilitaires
print_header() {
    echo -e "${BLUE}================================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}================================================${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

# Vérifier si on est root
if [ "$EUID" -eq 0 ]; then 
    print_warning "Ne pas exécuter ce script en tant que root"
    print_info "Exécutez avec votre utilisateur normal qui a accès à Docker"
    exit 1
fi

print_header "Installation - Gestion Commerciale"
echo ""

# ============================================
# 1. VÉRIFICATIONS PRÉALABLES
# ============================================

print_header "1. Vérifications préalables"
echo ""

# Vérifier OS
print_info "Vérification du système d'exploitation..."
if [ -f /etc/redhat-release ]; then
    OS_VERSION=$(cat /etc/redhat-release)
    print_success "RedHat détecté: $OS_VERSION"
else
    print_warning "Ce script est optimisé pour RedHat, mais peut fonctionner sur d'autres systèmes"
fi

# Vérifier Docker
print_info "Vérification de Docker..."
if command -v docker &> /dev/null; then
    DOCKER_VERSION=$(docker --version)
    print_success "Docker installé: $DOCKER_VERSION"
    
    # Vérifier les permissions Docker
    if docker ps &> /dev/null; then
        print_success "Permissions Docker OK"
    else
        print_error "L'utilisateur n'a pas les permissions Docker"
        print_info "Exécutez: sudo usermod -aG docker $USER && newgrp docker"
        exit 1
    fi
else
    print_error "Docker n'est pas installé"
    print_info "Installez Docker avec: sudo yum install docker -y"
    exit 1
fi

# Vérifier Docker Compose
print_info "Vérification de Docker Compose..."
if command -v docker-compose &> /dev/null; then
    COMPOSE_VERSION=$(docker-compose --version)
    print_success "Docker Compose installé: $COMPOSE_VERSION"
else
    print_error "Docker Compose n'est pas installé"
    print_info "Installez Docker Compose"
    exit 1
fi

echo ""

# ============================================
# 2. VÉRIFICATION DES PORTS
# ============================================

print_header "2. Vérification des ports"
echo ""

check_port() {
    PORT=$1
    if sudo netstat -tlnp 2>/dev/null | grep -q ":$PORT " || sudo ss -tlnp 2>/dev/null | grep -q ":$PORT "; then
        return 1
    else
        return 0
    fi
}

FRONTEND_PORT=3001
BACKEND_PORT=5001
DB_PORT=5433

print_info "Vérification du port $FRONTEND_PORT (Frontend)..."
if check_port $FRONTEND_PORT; then
    print_success "Port $FRONTEND_PORT disponible"
else
    print_warning "Port $FRONTEND_PORT occupé"
    read -p "Entrez un nouveau port pour le frontend [3002]: " NEW_PORT
    FRONTEND_PORT=${NEW_PORT:-3002}
fi

print_info "Vérification du port $BACKEND_PORT (Backend)..."
if check_port $BACKEND_PORT; then
    print_success "Port $BACKEND_PORT disponible"
else
    print_warning "Port $BACKEND_PORT occupé"
    read -p "Entrez un nouveau port pour le backend [5002]: " NEW_PORT
    BACKEND_PORT=${NEW_PORT:-5002}
fi

print_info "Vérification du port $DB_PORT (PostgreSQL)..."
if check_port $DB_PORT; then
    print_success "Port $DB_PORT disponible"
else
    print_warning "Port $DB_PORT occupé"
    read -p "Entrez un nouveau port pour PostgreSQL [5434]: " NEW_PORT
    DB_PORT=${NEW_PORT:-5434}
fi

echo ""

# ============================================
# 3. CONFIGURATION DES VARIABLES
# ============================================

print_header "3. Configuration de l'application"
echo ""

# Obtenir l'IP du serveur
SERVER_IP=$(hostname -I | awk '{print $1}')
print_info "IP du serveur détectée: $SERVER_IP"

# Générer un mot de passe DB sécurisé
DB_PASSWORD=$(openssl rand -base64 16 | tr -d "=+/" | cut -c1-16)
print_success "Mot de passe DB généré"

# Générer un secret JWT
JWT_SECRET=$(openssl rand -base64 32)
print_success "Secret JWT généré"

# URL de l'API
API_URL="http://$SERVER_IP:$BACKEND_PORT/api"

echo ""

# ============================================
# 4. CRÉATION DU FICHIER .ENV
# ============================================

print_header "4. Création du fichier .env"
echo ""

print_info "Création du fichier de configuration..."

cat > .env << EOF
# Configuration générée automatiquement
# Date: $(date)

# Ports
FRONTEND_PORT=$FRONTEND_PORT
BACKEND_PORT=$BACKEND_PORT
DB_PORT=$DB_PORT

# Base de données
DB_NAME=gestion_commerciale
DB_USER=gestion_user
DB_PASSWORD=$DB_PASSWORD

# Backend
NODE_ENV=production
JWT_SECRET=$JWT_SECRET

# Frontend
REACT_APP_API_URL=$API_URL

# Projet
COMPOSE_PROJECT_NAME=gestion_commerciale
EOF

print_success "Fichier .env créé"

# Afficher les informations
echo ""
print_info "Configuration créée:"
echo "  - Frontend: http://$SERVER_IP:$FRONTEND_PORT"
echo "  - Backend:  http://$SERVER_IP:$BACKEND_PORT"
echo "  - PostgreSQL: localhost:$DB_PORT"
echo ""

# ============================================
# 5. CONSTRUCTION DES IMAGES
# ============================================

print_header "5. Construction des images Docker"
echo ""

print_info "Construction des images (cela peut prendre plusieurs minutes)..."
if docker-compose build; then
    print_success "Images construites avec succès"
else
    print_error "Erreur lors de la construction des images"
    exit 1
fi

echo ""

# ============================================
# 6. DÉMARRAGE DES SERVICES
# ============================================

print_header "6. Démarrage des services"
echo ""

print_info "Démarrage des conteneurs..."
if docker-compose up -d; then
    print_success "Services démarrés"
else
    print_error "Erreur lors du démarrage des services"
    exit 1
fi

echo ""
print_info "Attente du démarrage complet (30 secondes)..."
sleep 30

# ============================================
# 7. VÉRIFICATIONS FINALES
# ============================================

print_header "7. Vérifications finales"
echo ""

print_info "Vérification de l'état des services..."
docker-compose ps

echo ""
print_info "Test de l'API..."
if curl -s http://localhost:$BACKEND_PORT/api > /dev/null; then
    print_success "API accessible"
else
    print_warning "L'API ne répond pas encore, vérifiez les logs"
fi

echo ""

# ============================================
# 8. CONFIGURATION DU FIREWALL
# ============================================

print_header "8. Configuration du firewall (optionnel)"
echo ""

read -p "Voulez-vous configurer le firewall automatiquement ? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    print_info "Configuration du firewall..."
    
    if command -v firewall-cmd &> /dev/null; then
        sudo firewall-cmd --permanent --add-port=$FRONTEND_PORT/tcp
        sudo firewall-cmd --permanent --add-port=$BACKEND_PORT/tcp
        sudo firewall-cmd --reload
        print_success "Firewall configuré (firewalld)"
    elif command -v iptables &> /dev/null; then
        sudo iptables -A INPUT -p tcp --dport $FRONTEND_PORT -j ACCEPT
        sudo iptables -A INPUT -p tcp --dport $BACKEND_PORT -j ACCEPT
        sudo service iptables save
        print_success "Firewall configuré (iptables)"
    else
        print_warning "Aucun firewall détecté, configuration manuelle nécessaire"
    fi
fi

echo ""

# ============================================
# 9. CRÉATION DES SCRIPTS UTILITAIRES
# ============================================

print_header "9. Création des scripts utilitaires"
echo ""

# Script de sauvegarde
cat > backup.sh << 'EOF'
#!/bin/bash
BACKUP_DIR="./backups"
DATE=$(date +%Y%m%d_%H%M%S)
mkdir -p $BACKUP_DIR
docker exec gestion_commerciale_db pg_dump -U gestion_user gestion_commerciale > $BACKUP_DIR/db_$DATE.sql
gzip $BACKUP_DIR/db_$DATE.sql
echo "✅ Sauvegarde créée: $BACKUP_DIR/db_$DATE.sql.gz"
EOF
chmod +x backup.sh
print_success "Script backup.sh créé"

# Script de monitoring
cat > monitor.sh << 'EOF'
#!/bin/bash
echo "=== État des Services ==="
docker-compose ps
echo ""
echo "=== Utilisation Ressources ==="
docker stats --no-stream gestion_commerciale_frontend gestion_commerciale_backend gestion_commerciale_db
EOF
chmod +x monitor.sh
print_success "Script monitor.sh créé"

# Script d'arrêt
cat > stop.sh << 'EOF'
#!/bin/bash
echo "🛑 Arrêt de l'application..."
docker-compose stop
echo "✅ Application arrêtée"
EOF
chmod +x stop.sh
print_success "Script stop.sh créé"

# Script de démarrage
cat > start.sh << 'EOF'
#!/bin/bash
echo "🚀 Démarrage de l'application..."
docker-compose start
echo "✅ Application démarrée"
docker-compose ps
EOF
chmod +x start.sh
print_success "Script start.sh créé"

echo ""

# ============================================
# 10. RÉSUMÉ FINAL
# ============================================

print_header "✅ INSTALLATION TERMINÉE !"
echo ""

print_success "L'application est maintenant opérationnelle !"
echo ""

echo -e "${BLUE}📱 Accès à l'application:${NC}"
echo "   Frontend: http://$SERVER_IP:$FRONTEND_PORT"
echo "   API:      http://$SERVER_IP:$BACKEND_PORT/api"
echo ""

echo -e "${BLUE}🔐 Identifiants de connexion:${NC}"
echo "   Email:    admin@demo.com"
echo "   Password: admin123"
echo ""

echo -e "${BLUE}🗄️  Base de données:${NC}"
echo "   Host:     localhost"
echo "   Port:     $DB_PORT"
echo "   Database: gestion_commerciale"
echo "   User:     gestion_user"
echo "   Password: $DB_PASSWORD"
echo ""

echo -e "${BLUE}📝 Fichiers de configuration:${NC}"
echo "   .env           - Variables d'environnement"
echo "   backup.sh      - Sauvegarde de la base de données"
echo "   monitor.sh     - Monitoring des services"
echo "   start.sh       - Démarrer l'application"
echo "   stop.sh        - Arrêter l'application"
echo ""

echo -e "${BLUE}📋 Commandes utiles:${NC}"
echo "   docker-compose logs -f    - Voir les logs"
echo "   docker-compose ps         - État des services"
echo "   docker-compose restart    - Redémarrer"
echo "   ./backup.sh              - Faire une sauvegarde"
echo "   ./monitor.sh             - Vérifier l'état"
echo ""

echo -e "${YELLOW}⚠️  Prochaines étapes recommandées:${NC}"
echo "   1. Tester l'application dans le navigateur"
echo "   2. Configurer un reverse proxy (Nginx/Apache)"
echo "   3. Ajouter SSL avec Let's Encrypt"
echo "   4. Configurer les sauvegardes automatiques"
echo "   5. Mettre en place le monitoring"
echo ""

print_success "Installation terminée avec succès ! 🎉"
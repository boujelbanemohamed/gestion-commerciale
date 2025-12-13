# ==================================
# CONFIGURATION PRODUCTION - REDHAT
# ==================================

# ==================================
# PORTS (Modifiés pour éviter conflits)
# ==================================

# IMPORTANT: Vérifier que ces ports sont libres sur le serveur
# Utiliser: netstat -tlnp | grep -E "3001|5001|5433"

FRONTEND_PORT=3001     # Au lieu de 3000 (probablement déjà utilisé)
BACKEND_PORT=5001      # Au lieu de 5000 (probablement déjà utilisé)
DB_PORT=5433           # Au lieu de 5432 (probablement déjà utilisé)

# ==================================
# BASE DE DONNÉES
# ==================================

DB_HOST=postgres_gestion
DB_NAME=gestion_commerciale
DB_USER=gestion_user

# ⚠️ CHANGER CE MOT DE PASSE EN PRODUCTION
DB_PASSWORD=VotreMotDePasseSecurise2024!

# ==================================
# BACKEND
# ==================================

NODE_ENV=production
PORT=5000  # Port interne du conteneur (ne pas changer)

# ⚠️ GÉNÉRER UN NOUVEAU SECRET JWT
# Utiliser: openssl rand -base64 32
JWT_SECRET=VotreSecretJWTTresSecurise2024ChangezMoi!

# ==================================
# FRONTEND
# ==================================

# URL de l'API accessible depuis le navigateur
# Adapter selon votre configuration serveur (IP ou nom de domaine)
REACT_APP_API_URL=http://VOTRE_IP_SERVEUR:5001/api

# Si vous utilisez un reverse proxy:
# REACT_APP_API_URL=https://votre-domaine.com/gestion/api

# ==================================
# CONFIGURATION SERVEUR REDHAT
# ==================================

# Préfixe pour les noms de conteneurs (évite conflits)
COMPOSE_PROJECT_NAME=gestion_commerciale

# ==================================
# LIMITES RESSOURCES (Optionnel)
# ==================================

# Limites mémoire pour ne pas impacter les autres apps
POSTGRES_MEMORY_LIMIT=512M
BACKEND_MEMORY_LIMIT=512M
FRONTEND_MEMORY_LIMIT=256M

# ==================================
# LOGGING
# ==================================

# Niveau de logs (error, warn, info, debug)
LOG_LEVEL=info

# ==================================
# REVERSE PROXY (Si applicable)
# ==================================

# Si vous utilisez Nginx/Apache comme reverse proxy
# VIRTUAL_HOST=gestion.votre-domaine.com
# LETSENCRYPT_EMAIL=admin@votre-domaine.com

# ==================================
# NOTES IMPORTANTES
# ==================================

# 1. Ne JAMAIS committer ce fichier dans Git
# 2. Sauvegarder ce fichier dans un endroit sécurisé
# 3. Changer TOUS les mots de passe par défaut
# 4. Vérifier les ports disponibles avant le déploiement
# 5. Tester en environnement de staging avant la production
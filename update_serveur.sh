#!/bin/bash
# Script de mise à jour de l'application sur le serveur (Red Hat ou autre).
# À exécuter dans le répertoire du projet (ex: /opt/gestion-commerciale).
# Usage: ./update_serveur.sh

set -e

echo "🔄 Mise à jour de l'application..."

# Répertoire du script = répertoire du projet
cd "$(dirname "$0")"

# 1. Récupérer les dernières modifications depuis Git
echo "📥 Récupération des modifications (git pull)..."
git fetch origin
git pull origin main

# 2. Reconstruire les images Docker (sans cache pour prendre le nouveau code)
echo "🔨 Reconstruction des images..."
docker-compose build --no-cache

# 3. Redémarrer les services
echo "♻️ Redémarrage des services..."
docker-compose down
docker-compose up -d

# 4. Vérifier le statut
echo "⏳ Attente du démarrage (15 s)..."
sleep 15
echo "✅ Statut des conteneurs :"
docker-compose ps

echo ""
echo "✨ Mise à jour terminée."

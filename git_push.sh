#!/bin/bash

echo "╔════════════════════════════════════════════════╗"
echo "║     GIT PUSH - GESTION COMMERCIALE            ║"
echo "╚════════════════════════════════════════════════╝"
echo ""

cd /opt/applications/gestion-commerciale

# Vérifier qu'on est dans un repo git
if [ ! -d .git ]; then
    echo "❌ Erreur: Pas un repository Git"
    exit 1
fi

echo "📊 État actuel du repository:"
git status
echo ""

# Demander confirmation
read -p "Voulez-vous continuer avec le push? (y/n) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ Push annulé"
    exit 1
fi

# Demander le message de commit
echo ""
read -p "Message de commit: " COMMIT_MSG

if [ -z "$COMMIT_MSG" ]; then
    COMMIT_MSG="Update: Modifications du $(date '+%Y-%m-%d %H:%M')"
fi

echo ""
echo "📝 Ajout des fichiers..."
git add .

echo ""
echo "💾 Commit..."
git commit -m "$COMMIT_MSG"

echo ""
echo "🚀 Push vers GitHub..."
git push origin main

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Push réussi!"
    echo "🌐 Repository: https://github.com/boujelbanemohamed/gestion-commerciale"
else
    echo ""
    echo "❌ Erreur lors du push"
    exit 1
fi

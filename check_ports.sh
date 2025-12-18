#!/bin/bash
echo "🔍 Vérification des ports pour Gestion Commerciale..."
echo ""
PORTS=(3001 5001 5433)
ALL_FREE=true

for PORT in "${PORTS[@]}"; do
    if sudo netstat -tlnp 2>/dev/null | grep -q ":$PORT " || sudo ss -tlnp 2>/dev/null | grep -q ":$PORT "; then
        echo "❌ Port $PORT est OCCUPÉ"
        sudo netstat -tlnp 2>/dev/null | grep ":$PORT"
        ALL_FREE=false
    else
        echo "✅ Port $PORT est LIBRE"
    fi
done

echo ""
if [ "$ALL_FREE" = true ]; then
    echo "✅ Tous les ports sont disponibles ! Vous pouvez continuer."
    exit 0
else
    echo "❌ Certains ports sont occupés. Modifiez le fichier .env"
    exit 1
fi

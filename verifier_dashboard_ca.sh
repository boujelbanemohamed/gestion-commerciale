#!/bin/bash
# Script pour vérifier et appliquer la correction du dashboard CA (toutes les devises configurées)
# Usage : depuis le dossier gestion-commerciale : ./verifier_dashboard_ca.sh

set -e
cd "$(dirname "$0")"

API_URL="${API_URL:-http://localhost:5001}"
if command -v curl &> /dev/null; then
  echo "=== Avant redémarrage : appel $API_URL/api/stats/dashboard ==="
  if response=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/api/stats/dashboard" 2>/dev/null); then
    body=$(curl -s "$API_URL/api/stats/dashboard" 2>/dev/null)
    count=$(echo "$body" | grep -o '"currency_code"' | wc -l | tr -d ' ')
    header=$(curl -sI "$API_URL/api/stats/dashboard" 2>/dev/null | grep -i "X-Dashboard-Currencies" || true)
    echo "  Réponse HTTP: $response"
    echo "  Nombre de devises dans revenue_by_currency: $count"
    echo "  En-tête X-Dashboard-Currencies: ${header:-absent (ancienne version)}"
    if [ "$count" -lt 5 ] || [ -z "$header" ]; then
      echo "  => Le backend utilise encore l'ancienne version. Il faut reconstruire."
    fi
  else
    echo "  Impossible de joindre le backend (démarré ?). Lancez d'abord l'app."
  fi
fi

echo ""
echo "=== Reconstruction du backend (Docker) ==="
if docker-compose ps backend_gestion &>/dev/null 2>&1 || docker compose ps backend_gestion &>/dev/null 2>&1; then
  echo "Arrêt et reconstruction du conteneur backend..."
  (docker-compose build --no-cache backend_gestion 2>/dev/null || docker compose build --no-cache backend_gestion 2>/dev/null) && true
  (docker-compose up -d backend_gestion 2>/dev/null || docker compose up -d backend_gestion 2>/dev/null) && true
  echo "Attente 5 secondes..."
  sleep 5
  echo ""
  echo "=== Après redémarrage : appel $API_URL/api/stats/dashboard ==="
  body=$(curl -s "$API_URL/api/stats/dashboard" 2>/dev/null)
  count=$(echo "$body" | grep -o '"currency_code"' | wc -l | tr -d ' ')
  header=$(curl -sI "$API_URL/api/stats/dashboard" 2>/dev/null | grep -i "X-Dashboard-Currencies" || true)
  echo "  Nombre de devises dans revenue_by_currency: $count (attendu: 5)"
  echo "  En-tête X-Dashboard-Currencies: ${header:-absent}"
  if [ "$count" -eq 5 ]; then
    echo "  => OK. Rechargez la page du dashboard (Ctrl+F5)."
  else
    echo "  => Si le backend n'est pas en Docker, redémarrez-le manuellement (node server.js)."
  fi
else
  echo "Docker Compose ne semble pas utilisé pour ce projet."
  echo "Redémarrez le backend à la main : cd backend && node server.js"
fi

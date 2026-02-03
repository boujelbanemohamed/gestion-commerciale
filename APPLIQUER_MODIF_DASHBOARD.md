# Appliquer les modifications du dashboard (CA HT par devise)

Si vous ne voyez que 2 cartes CA (TND, USD), le backend exécuté est encore l’ancienne version. **Il faut reconstruire et redémarrer le backend** pour voir les 5 devises.

**Vérification rapide** : `curl -s http://localhost:5001/api/stats/dashboard | grep -o '"currency_code"' | wc -l` → doit afficher **5** (nouvelle version). Si 2 = ancienne version.

## Si vous lancez l’app avec Docker

Depuis le dossier `gestion-commerciale` :

```bash
# Reconstruire l’image du backend (pour prendre server.js à jour)
docker-compose build backend_gestion

# Redémarrer le conteneur backend
docker-compose up -d backend_gestion
```

Si le frontend est aussi en Docker et que vous avez modifié `App.js` :

```bash
docker-compose build frontend_gestion
docker-compose up -d frontend_gestion
```

Puis recharger la page du dashboard (Ctrl+F5 ou Cmd+Shift+R).

## Si vous lancez en local (sans Docker)

1. **Backend** : arrêter le serveur (Ctrl+C) puis relancer, par exemple :
   ```bash
   cd gestion-commerciale/backend
   node server.js
   ```
2. **Frontend** : recharger la page (Ctrl+F5). Si vous utilisez `npm start`, pas besoin de le relancer pour les changements dans `src/`.

## Vérifier que ça fonctionne

Ouvrir dans le navigateur (en remplaçant par votre URL si besoin) :

- **Avec proxy** : `http://localhost:3000/api/stats/dashboard?t=1`
- **Backend direct** : `http://localhost:5001/api/stats/dashboard?t=1`

Dans la réponse JSON, `revenue_by_currency` doit contenir **une entrée pour chaque devise** de Configuration > Devises (ex. EUR, GBP, TND, USD), avec un `total` (éventuellement 0).

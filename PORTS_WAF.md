# Ports à déclarer au WAF (Web Application Firewall)

## Ports exposés par l'application

| Service   | Port par défaut | Variable .env   | À exposer au WAF ? |
|-----------|-----------------|-----------------|--------------------|
| Frontend  | 3000            | FRONTEND_PORT   | Oui (HTTP)         |
| Backend   | 5000            | BACKEND_PORT    | Oui (API)          |
| PostgreSQL| 5433             | DB_PORT         | Non (interne)      |

Sur le serveur Red Hat, si vous utilisez le fichier `.env` avec des ports personnalisés (ex. 3001, 5001), déclarez **ces mêmes ports** dans le WAF.

---

## Ports à autoriser dans le WAF

À déclarer en **entrée (inbound)** sur l’IP du serveur :

1. **Frontend** : port **3000** (ou la valeur de `FRONTEND_PORT` dans `.env`, ex. 3001)  
   - Protocole : TCP  
   - Usage : interface web (navigateur)

2. **Backend** : port **5000** (ou la valeur de `BACKEND_PORT` dans `.env`, ex. 5001)  
   - Protocole : TCP  
   - Usage : appels API depuis le frontend (et éventuellement Postman, etc.)

**Ne pas exposer** le port de la base de données (5433) au WAF ni sur Internet.

---

## Option recommandée : reverse proxy (80 / 443 uniquement)

Pour simplifier la configuration du WAF, vous pouvez n’autoriser que les ports **80** (HTTP) et **443** (HTTPS) et faire passer tout le trafic par un reverse proxy (Nginx) sur le serveur :

- Le WAF autorise uniquement **80** et **443**.
- Nginx écoute sur 80/443 et redirige :
  - `/` → frontend (conteneur sur 3000 ou 3001)
  - `/api` → backend (conteneur sur 5000 ou 5001)

Ainsi, vous n’avez **aucun port 3000, 3001, 5000 ou 5001** à déclarer au WAF.

Exemple de configuration Nginx (à adapter selon vos ports et domaine) :

```nginx
# Exemple : tout le trafic sur le port 80
server {
    listen 80;
    server_name votre-domaine.com;  # ou l'IP du serveur

    # Frontend (application React)
    location / {
        proxy_pass http://127.0.0.1:3000;   # ou 3001 si FRONTEND_PORT=3001
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Backend (API)
    location /api {
        proxy_pass http://127.0.0.1:5000;   # ou 5001 si BACKEND_PORT=5001
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Fichiers uploadés (logos, signatures)
    location /uploads {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

Avec cette solution, dans le WAF vous ne déclarez que les ports **80** et **443**.

# Étape de build
FROM node:18-alpine as build

WORKDIR /app

# Accepter l'argument REACT_APP_API_URL
ARG REACT_APP_API_URL=http://localhost:5001/api
ENV REACT_APP_API_URL=$REACT_APP_API_URL

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# Étape de production avec Nginx
FROM nginx:alpine

COPY --from=build /app/build /usr/share/nginx/html

# Ajouter curl pour le healthcheck
RUN apk add --no-cache curl

# Configuration Nginx pour React Router
RUN cat > /etc/nginx/conf.d/default.conf <<'EOF'
server {
    listen 80;

    # Autoriser des requêtes volumineuses (PDF encodé en base64 dans le body JSON)
    client_max_body_size 50M;

    location / {
        root /usr/share/nginx/html;
        index index.html index.htm;
        try_files $uri $uri/ /index.html;
        add_header Cache-Control "no-cache, no-store, must-revalidate";
    }

    location ~* \.(js|css)$ {
        root /usr/share/nginx/html;
        add_header Cache-Control "no-cache, no-store, must-revalidate";
    }

    location /api {
        proxy_pass http://backend_gestion:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        # Augmenter les timeouts pour les opérations longues (ex: envoi d'emails avec gros PDF)
        proxy_connect_timeout 300s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;
    }

    # Proxy des fichiers statiques servis par le backend (signatures, pièces jointes, etc.)
    location /uploads {
        proxy_pass http://backend_gestion:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
EOF

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
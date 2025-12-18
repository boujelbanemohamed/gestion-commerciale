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

    location / {
        root /usr/share/nginx/html;
        index index.html index.htm;
        try_files $uri $uri/ /index.html;
    }

    location /api {
        proxy_pass http://backend_gestion:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
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
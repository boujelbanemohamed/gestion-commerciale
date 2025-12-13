FROM node:18-alpine

WORKDIR /app

# Installer les dépendances en premier pour profiter du cache
COPY package*.json ./
RUN npm install --production && apk add --no-cache curl

# Copier le code source
COPY . .

# Créer le dossier pour les uploads
RUN mkdir -p uploads/quotes

# Exposer le port de l'API
EXPOSE 5000

# Démarrer le serveur
CMD ["node", "server.js"]


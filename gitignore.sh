# Variables d'environnement
.env
.env.local
.env.development
.env.production

# Node modules
node_modules/
backend/node_modules/
frontend/node_modules/

# Logs
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*
lerna-debug.log*

# Build
backend/dist/
frontend/build/
frontend/.next/

# Docker
docker-compose.override.yml

# IDE
.vscode/
.idea/
*.swp
*.swo
*~
.DS_Store

# Tests
coverage/
.nyc_output/

# Temporary files
*.tmp
*.temp
.cache/

# PostgreSQL data (si volume local)
postgres-data/
# Mise à jour de l'application sur le serveur Red Hat

Commandes à exécuter **sur le serveur Red Hat** pour récupérer les mises à jour depuis Git et redémarrer l'application.

**Chemin de l'application sur le serveur :** `/data/applications/gestion-commerciale`

---

## Prérequis

- L'application est déjà déployée dans `/data/applications/gestion-commerciale`.
- Git et Docker / Docker Compose sont installés sur le serveur.
- Vous avez les droits pour faire `git pull` (dépôt cloné avec accès en lecture).

---

## Option 1 : Commandes manuelles

Connectez-vous au serveur, puis exécutez :

```bash
# 1. Aller dans le répertoire de l'application
cd /data/applications/gestion-commerciale

# 2. Récupérer les mises à jour depuis GitHub
git fetch origin
git pull origin main

# 3. Reconstruire les images Docker (pour prendre le nouveau code)
docker compose build --no-cache

# 4. Redémarrer les conteneurs
docker compose down
docker compose up -d

# 5. Vérifier que tout tourne
sleep 15
docker compose ps
```

---

## Option 2 : Script de mise à jour

Après avoir fait **une première fois** un `git pull` (pour récupérer le script), vous pouvez utiliser le script :

```bash
cd /data/applications/gestion-commerciale
chmod +x update_serveur.sh
./update_serveur.sh
```

À chaque nouvelle mise à jour, il suffit de lancer :

```bash
cd /data/applications/gestion-commerciale
./update_serveur.sh
```

(Le script fait lui-même `git pull`, `docker compose build`, puis redémarre les services.)

---

## Premier déploiement sur le serveur (si pas encore cloné)

Si le projet n'est pas encore sur le serveur :

```bash
sudo mkdir -p /data/applications/gestion-commerciale
sudo chown -R $USER:$USER /data/applications/gestion-commerciale
cd /data/applications/gestion-commerciale
git clone https://github.com/boujelbanemohamed/gestion-commerciale.git .
# Puis configurer .env et lancer : docker compose up -d
```

---

## Sauvegarde optionnelle avant mise à jour

Pour sauvegarder la base de données avant de mettre à jour :

```bash
cd /data/applications/gestion-commerciale
docker exec gestion_commerciale_db pg_dump -U gestion_user gestion_commerciale > backup_$(date +%Y%m%d_%H%M%S).sql
```

Puis exécutez les commandes de mise à jour (option 1 ou 2).

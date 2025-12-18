#!/usr/bin/env bash
set -euo pipefail

# Déploiement Git (push) sans stocker de secrets dans le repo.
# - Option 1 (recommandée): utiliser le trousseau macOS / credential helper (git push vous demandera une fois).
# - Option 2 (CI / non-interactif): exporter GITHUB_TOKEN (et optionnellement GITHUB_USERNAME) avant d'exécuter ce script.
#
# Exemple CI (NE PAS COMMIT le token):
#   export GITHUB_TOKEN="...token..."
#   export GITHUB_USERNAME="boujelbanemohamed"   # optionnel; sinon x-access-token
#   ./git_deploy.sh

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

REMOTE="${GIT_REMOTE:-origin}"
BRANCH="${GIT_BRANCH:-$(git branch --show-current)}"

if [[ -z "${BRANCH:-}" ]]; then
  echo "❌ Impossible de détecter la branche courante."
  exit 1
fi

echo "📌 Repo:   $REPO_ROOT"
echo "📌 Remote: $REMOTE"
echo "📌 Branch: $BRANCH"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "❌ Ce dossier n'est pas un dépôt Git."
  exit 1
fi

if ! git remote get-url "$REMOTE" >/dev/null 2>&1; then
  echo "❌ Remote introuvable: $REMOTE"
  git remote -v || true
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "❌ Vous avez des changements non commités. Faites un commit avant de pousser."
  git status --porcelain
  exit 1
fi

echo "✅ Working tree propre."

# Mode non-interactif via GITHUB_TOKEN (utile CI).
if [[ -n "${GITHUB_TOKEN:-}" ]]; then
  TMP_ASKPASS="$(mktemp -t git_askpass.XXXXXX)"
  chmod 700 "$TMP_ASKPASS"
  cat > "$TMP_ASKPASS" <<'EOF'
#!/usr/bin/env sh
case "$1" in
  *Username* ) echo "${GITHUB_USERNAME:-x-access-token}" ;;
  *Password* ) echo "${GITHUB_TOKEN:-}" ;;
  * ) echo "" ;;
esac
EOF

  # Empêcher Git de demander en TTY (sinon ça bloque en CI)
  export GIT_TERMINAL_PROMPT=0
  export GIT_ASKPASS="$TMP_ASKPASS"

  echo "🚀 Push (mode token via env) ..."
  set +e
  git push "$REMOTE" "$BRANCH"
  rc=$?
  set -e

  rm -f "$TMP_ASKPASS"

  if [[ $rc -ne 0 ]]; then
    echo "❌ Push échoué (auth/permissions?)."
    echo "ℹ️  Vérifiez que le token a bien les droits d'écriture sur le repo."
    exit $rc
  fi

  echo "✅ Push OK."
  exit 0
fi

echo "🚀 Push (mode interactif/Keychain) ..."
git push "$REMOTE" "$BRANCH"
echo "✅ Push OK."



#!/usr/bin/env bash
# Generates infra/langfuse/.env with random secrets (never overwrites an
# existing one) and appends the Langfuse API keys to backend/.env so the
# backend SDK can send traces. Both files are git-ignored.
set -euo pipefail
cd "$(dirname "$0")"

ENV_FILE=.env
BACKEND_ENV=../../backend/.env

if [[ -f "$ENV_FILE" ]]; then
  echo "[skip] $ENV_FILE already exists -- not regenerating secrets"
else
  hex() { openssl rand -hex "$1"; }
  cat > "$ENV_FILE" <<EOF
POSTGRES_PASSWORD=$(hex 16)
CLICKHOUSE_PASSWORD=$(hex 16)
REDIS_AUTH=$(hex 16)
MINIO_ROOT_PASSWORD=$(hex 16)
SALT=$(hex 16)
ENCRYPTION_KEY=$(hex 32)
NEXTAUTH_SECRET=$(hex 32)
LANGFUSE_PUBLIC_KEY=pk-lf-$(hex 16)
LANGFUSE_SECRET_KEY=sk-lf-$(hex 16)
LANGFUSE_ADMIN_EMAIL=admin@qorgau.local
LANGFUSE_ADMIN_PASSWORD=$(hex 8)
EOF
  chmod 600 "$ENV_FILE"
  echo "[ok] wrote $ENV_FILE"
fi

# shellcheck disable=SC1090
source "$ENV_FILE"
touch "$BACKEND_ENV"
if grep -q '^LANGFUSE_PUBLIC_KEY=' "$BACKEND_ENV"; then
  echo "[skip] Langfuse keys already present in backend/.env"
else
  {
    echo "LANGFUSE_PUBLIC_KEY=$LANGFUSE_PUBLIC_KEY"
    echo "LANGFUSE_SECRET_KEY=$LANGFUSE_SECRET_KEY"
    echo "LANGFUSE_BASE_URL=http://localhost:3001"
  } >> "$BACKEND_ENV"
  echo "[ok] appended Langfuse keys to backend/.env"
fi

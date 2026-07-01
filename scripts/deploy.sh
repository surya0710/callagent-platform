#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/var/www/ai-voice-platform"
cd "$APP_DIR"

echo "==> Syncing to origin/main"
git fetch origin main
git checkout main 2>/dev/null || git checkout -B main origin/main
git reset --hard origin/main

echo "==> Installing backend dependencies"
cd backend
if [ ! -f ".env" ]; then
  echo "backend/.env is missing. Create it from backend/.env.example before deploying."
  exit 1
fi

ensure_env_var() {
  local key="$1"
  local value="$2"
  if ! grep -q "^${key}=" .env; then
    echo "${key}=${value}" >> .env
    echo "Added missing ${key} to backend/.env"
  fi
}

echo "==> Ensuring voice recording env vars"
ensure_env_var "VOICE_RECORDINGS_STORAGE_DRIVER" "local"
ensure_env_var "VOICE_RECORDINGS_STORAGE_PATH" "storage"

echo "==> Ensuring speak-first greeting fires immediately on connect"
ensure_env_var "VOICE_AI_SPEAK_FIRST_ENABLED" "true"
if grep -q "^VOICE_AI_SPEAK_FIRST_OPENING_DELAY_MS=" .env; then
  sed -i 's/^VOICE_AI_SPEAK_FIRST_OPENING_DELAY_MS=.*/VOICE_AI_SPEAK_FIRST_OPENING_DELAY_MS=0/' .env
  echo "Set VOICE_AI_SPEAK_FIRST_OPENING_DELAY_MS=0 in backend/.env"
else
  ensure_env_var "VOICE_AI_SPEAK_FIRST_OPENING_DELAY_MS" "0"
fi

if [ -f "pnpm-lock.yaml" ]; then
  pnpm install --frozen-lockfile
else
  npm ci
fi

echo "==> Running Prisma generate"
npx prisma generate

echo "==> Running database migrations"
run_migrate_deploy() {
  npx prisma migrate deploy 2>&1
}

MIGRATE_OUTPUT="$(run_migrate_deploy)" && {
  echo "$MIGRATE_OUTPUT"
} || {
  echo "$MIGRATE_OUTPUT" >&2
  if echo "$MIGRATE_OUTPUT" | grep -q 'P3009'; then
    FAILED_MIGRATION="$(echo "$MIGRATE_OUTPUT" | sed -n 's/.*The `\([^`]*\)` migration.*/\1/p' | head -1)"
    if [ -n "$FAILED_MIGRATION" ]; then
      echo "==> Recovering failed migration (not applied): $FAILED_MIGRATION"
      npx prisma migrate resolve --rolled-back "$FAILED_MIGRATION"
      npx prisma migrate deploy
    else
      exit 1
    fi
  else
    exit 1
  fi
}

if [ "${RUN_PRISMA_SEED:-true}" = "true" ]; then
  echo "==> Seeding database roles, permissions, and defaults"
  npx prisma db seed
fi

echo "==> Building backend"
npm run build

echo "==> Installing frontend dependencies"
cd ../frontend
if [ -f "pnpm-lock.yaml" ]; then
  pnpm install --frozen-lockfile
else
  npm ci
fi

echo "==> Building frontend"
npm run build

echo "==> Restarting PM2 processes"
cd ../backend
pm2 startOrReload ecosystem.config.js --update-env
pm2 save

echo "==> Deployment complete"

#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/var/www/ai-voice-platform"
cd "$APP_DIR"

echo "==> Pulling latest code"
git pull origin main

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

if [ -f "pnpm-lock.yaml" ]; then
  pnpm install --frozen-lockfile
else
  npm ci
fi

echo "==> Running Prisma generate"
npx prisma generate

echo "==> Running database migrations"
npx prisma migrate deploy

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

# Deployment

## What each deployment file does

| File | Purpose |
|------|---------|
| `.github/workflows/deploy.yml` | GitHub Actions workflow that SSHs into EC2 after pushes to `main` |
| `scripts/deploy.sh` | Bare-metal EC2 deployment script for Node/Nginx/PM2 |
| `backend/ecosystem.config.js` | PM2 process definitions for API and worker |
| `backend/Dockerfile` | Docker image for the NestJS API, worker, Prisma migrations, and seeds |
| `frontend/Dockerfile` | Docker image for the built React app served by Nginx |
| `docker-compose.yml` | Optional full Docker deployment with MySQL, Redis, API, worker, migrations, and frontend |

`deploy.yml` is not a Dockerfile. It is a GitHub Actions workflow.

## Current recommended path: EC2 + Nginx + PM2

This matches the existing server setup.

### Server prerequisites

- Ubuntu 24.04 EC2 instance
- Elastic IP: `52.66.68.49`
- `deploy` Linux user with SSH access
- Repository cloned at `/var/www/ai-voice-platform`
- Node.js 22
- npm, and optionally pnpm
- PM2
- MySQL
- Redis
- Nginx
- GitHub secret `EC2_SSH_KEY` containing the private key for the `deploy` user

### Backend environment

Create `/var/www/ai-voice-platform/backend/.env` on the server:

```env
NODE_ENV=production
PORT=3000
DATABASE_URL=mysql://ai_voice_user:replace-with-password@localhost:3306/ai_voice_platform
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
JWT_SECRET=replace-with-a-long-random-secret
JWT_EXPIRES_IN=1d
AUTH_COOKIE_SECURE=false
AI_PROVIDER=openai
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
OPENAI_TRANSCRIPTION_MODEL=gpt-4o-transcribe
OPENAI_FINE_TUNE_MODEL=gpt-4.1-mini-2025-04-14
AWS_REGION=us-east-1
BEDROCK_MODEL_ID=
CORS_ORIGIN=http://52.66.68.49
REDIS_ENABLED=true
SEED_DEV_INTEGRATION_API_KEY=false
```

Keep `AUTH_COOKIE_SECURE=false` while the site is served over plain HTTP. Set it to `true` only after HTTPS is configured.

### Nginx reference

```nginx
server {
    listen 80;
    server_name 52.66.68.49;

    root /var/www/ai-voice-platform/frontend/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Deploy manually on EC2

```bash
cd /var/www/ai-voice-platform
git pull origin main
bash ./scripts/deploy.sh
```

The script installs dependencies from lockfiles, runs `prisma generate`, applies migrations, runs the idempotent seed, builds backend/frontend, restarts PM2, and saves PM2 state.

### Deploy through GitHub Actions

1. Commit and push to `main`.
2. GitHub Actions runs `.github/workflows/deploy.yml`.
3. The workflow SSHs into EC2 and executes `bash ./scripts/deploy.sh`.

## Optional Docker deployment

Docker deployment is now scaffolded but is an alternative to the PM2/Nginx setup above.

### Docker server prerequisites

- Docker Engine
- Docker Compose plugin
- Ports available:
  - `3000` for backend API
  - `8080` for frontend container
  - `3306` and `6379` if using the bundled MySQL/Redis containers

### Configure Docker environment

```bash
cd /var/www/ai-voice-platform
cp .env.docker.example .env
nano .env
```

Set strong values for `MYSQL_PASSWORD`, `MYSQL_ROOT_PASSWORD`, and `JWT_SECRET`. Use `AI_PROVIDER=mock` until OpenAI is configured, or set `AI_PROVIDER=openai` with `OPENAI_API_KEY`.

### Run with Docker Compose

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f api
```

The `migrate` service runs Prisma migrations and the seed before the API and worker start.

### Nginx in front of Docker

If using the frontend container, point host Nginx to the frontend container:

```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

The frontend container proxies `/api` to the `api` service inside Docker.

## Smoke tests

```bash
curl http://52.66.68.49/api/health
curl http://52.66.68.49/api/docs
pm2 status
```

Then open `http://52.66.68.49`, register the first admin user, and verify login.

## Future production hardening

- Add HTTPS and set `AUTH_COOKIE_SECURE=true`
- Use a domain name
- Move secrets to AWS SSM/Secrets Manager or GitHub Actions environment secrets
- Add database backups
- Add log rotation and monitoring

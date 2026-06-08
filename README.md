# AI Voice Platform

Production-grade outbound AI voice calling platform.

## Status

**Checkpoint 3 complete:** Full backend API, React admin dashboard, PM2 deployment script, and Docker deployment scaffold.

See [docs/handover/CURRENT_STATUS.md](docs/handover/CURRENT_STATUS.md) for details.

## Quick start

```bash
cd backend
cp .env.example .env
pnpm install   # or npm install
pnpm prisma:generate
pnpm prisma:migrate:deploy
pnpm prisma:seed
pnpm start:dev
```

- API: http://localhost:3000/api
- Swagger: http://localhost:3000/api/docs

## Deployment

- PM2/Nginx deployment: `bash scripts/deploy.sh`
- Docker deployment: `docker compose up -d --build`

See [docs/devops/DEPLOYMENT.md](docs/devops/DEPLOYMENT.md) for the full server runbook.

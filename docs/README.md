# AI Voice Platform Documentation

Production-grade outbound AI voice calling platform with a NestJS API and React admin dashboard.

## Repository layout

| Path | Purpose |
|------|---------|
| `backend/` | NestJS API, Prisma, BullMQ workers |
| `frontend/` | React admin dashboard |
| `infrastructure/` | Server and deployment configuration |
| `scripts/` | Deployment and utility scripts |
| `docs/` | Architecture and operations documentation |

## Quick start (backend)

```bash
cd backend
cp .env.example .env
pnpm install
pnpm prisma:generate
pnpm prisma:migrate
pnpm prisma:seed
pnpm start:dev
```

API: `http://localhost:3000/api`  
Swagger: `http://localhost:3000/api/docs`

## Documentation index

- [Backend Architecture](./backend/BACKEND_ARCHITECTURE.md)
- [Database Design](./database/DATABASE_DESIGN.md)
- [Deployment](./devops/DEPLOYMENT.md)
- [AI Provider Strategy](./ai/AI_PROVIDER_STRATEGY.md)
- [Training Workflow](./ai/TRAINING_WORKFLOW.md)
- [External Integration API](./integrations/EXTERNAL_API.md)
- [Current Status](./handover/CURRENT_STATUS.md)

## Current checkpoint

Checkpoint 3 is implemented: backend API, Prisma schema/migrations, queues, AI provider abstraction, React admin dashboard, deployment script, and Docker scaffold.

Next checkpoint: real telephony provider integration, Bedrock/Nova Sonic provider implementation, HTTPS/domain setup, and production observability.

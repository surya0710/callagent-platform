# Database Design

MySQL database managed by Prisma. Connection string: `DATABASE_URL`.

## Core identity tables

| Table | Description |
|-------|-------------|
| `users` | Platform users with `active` / `disabled` status |
| `roles` | Named roles: `admin`, `manager`, `agent` |
| `permissions` | Fine-grained permissions (e.g. `campaigns.write`) |
| `role_permissions` | Many-to-many role ↔ permission |
| `user_roles` | Many-to-many user ↔ role |

## Domain tables

| Table | Description |
|-------|-------------|
| `customers` | Call targets with soft delete (`deleted_at`) |
| `campaigns` | Outbound campaigns with lifecycle status |
| `campaign_customers` | Campaign membership |
| `calls` | Individual outbound call records |
| `call_events` | Timeline events per call |
| `call_transcripts` | Full transcript per call |
| `call_summaries` | AI-generated summary and sentiment |
| `agent_prompts` | Versioned AI agent system prompts |
| `system_settings` | Key/value JSON configuration |
| `audit_logs` | User and system audit trail |

## Indexes

Indexes are defined on:

- `customers.phone`, `customers.status`, `customers.created_at`
- `campaigns.status`, `campaigns.created_at`
- `calls.status`, `calls.campaign_id`, `calls.customer_id`, `calls.created_at`
- `call_events.call_id`, `call_events.created_at`
- `audit_logs.user_id`, `audit_logs.entity_type`, `audit_logs.created_at`

## Seed data

`prisma/seed.ts` seeds:

- Default permissions
- `admin`, `manager`, `agent` roles with permission mappings
- Default active agent prompt
- `platform.initialized` system setting

## Migrations

```bash
cd backend
pnpm prisma:migrate      # development
pnpm prisma:migrate:deploy  # production
pnpm prisma:seed
```

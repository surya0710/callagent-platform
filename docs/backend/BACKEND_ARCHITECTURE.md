# Backend Architecture

## Stack

- **NestJS 11** with TypeScript
- **Prisma** ORM on **MySQL**
- **Redis + BullMQ** for background jobs
- **JWT + Passport** authentication
- **RBAC** with role and permission guards
- **Swagger** at `/api/docs`
- **Pino** structured logging with sensitive field redaction

## Module layout

```
src/
├── main.ts              # HTTP bootstrap, Swagger, security middleware
├── worker.ts            # BullMQ worker bootstrap
├── app.module.ts        # Root module and global guards
├── config/              # Environment validation
├── database/            # Prisma service
├── common/              # Guards, decorators, shared DTOs
├── queues/              # BullMQ queue registration
└── modules/
    ├── auth/
    ├── users/
    ├── rbac/
    ├── health/
    ├── agent-prompts/
    ├── ai/
    └── audit-logs/
```

## Security model

Global guards are registered in `app.module.ts`:

1. `ThrottlerGuard` — rate limiting (100 req/min)
2. `JwtAuthGuard` — bearer token auth (skipped on `@Public()` routes)
3. `RolesGuard` — optional `@RequireRoles()`
4. `PermissionsGuard` — optional `@RequirePermissions()`

Passwords are hashed with bcrypt (12 rounds). Tokens and passwords are redacted from logs.

### Session authentication (httpOnly cookies)

- JWT is issued on `POST /api/auth/login` and `POST /api/auth/register-admin`
- Token is stored in cookie `ai_voice_access_token` with:
  - `httpOnly: true` — not accessible to JavaScript (mitigates XSS token theft)
  - `sameSite: lax` — CSRF mitigation for cross-site requests
  - `secure: true` in production (when HTTPS is enabled)
- `POST /api/auth/logout` clears the cookie
- `JwtStrategy` reads the cookie first, then falls back to `Authorization: Bearer` for Swagger/API clients
- Frontend uses `withCredentials: true` and same-origin `/api` requests (Vite proxy in dev, Nginx in prod)

## API prefix

All routes are served under `/api` to align with Nginx reverse proxy configuration.

## Queues

| Queue | Purpose |
|-------|---------|
| `campaign-calls` | Outbound dial jobs |
| `call-retries` | Failed call retries |
| `summaries` | Post-call AI summary generation |

Worker processors are placeholders in checkpoint 1 and will be implemented with campaign/call modules.

## Extension points

- **AI providers** — `AiProviderFactory` selects implementation via `AI_PROVIDER`
- **Telephony webhooks** — planned in Calls module
- **CSV import** — planned in Customers module

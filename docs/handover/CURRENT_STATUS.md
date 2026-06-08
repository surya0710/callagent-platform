# Current Status — Checkpoint 3

**Date:** 2026-06-08

## New in this checkpoint

### OpenAI live integration
- `OpenAiProvider` calls OpenAI Chat Completions API via `fetch`
- Falls back to placeholder when `OPENAI_API_KEY` is empty
- Used for summaries, sentiment, and test-response endpoints

### Queue processors
- `CampaignCallProcessor` — creates call records when campaign jobs run
- `CallRetryProcessor` — creates retry call records
- `SummaryProcessor` — generates AI summaries from transcripts
- **Inline fallback** when `REDIS_ENABLED=false` (local dev without Redis)

### Frontend forms
- Customers: create + CSV import
- Campaigns: create, add customers, schedule/pause/resume/retry
- Users: create with role selection
- Agent Prompts: create + activate

### Deployment hardening
- GitHub Actions runs deployment through `bash ./scripts/deploy.sh`
- `scripts/deploy.sh` uses lockfiles, applies migrations, runs the idempotent seed, builds both apps, and reloads PM2
- Docker scaffold added with backend/frontend Dockerfiles and `docker-compose.yml`
- `AUTH_COOKIE_SECURE=false` supports current HTTP-only Elastic IP deployment

## Still placeholders
- Telephony provider (real outbound dialing)
- Amazon Bedrock / Nova Sonic
- HTTPS on EC2
- Customer edit form on detail page

## Quick test flow

1. Add customers via UI or CSV import
2. Create campaign → add customers → Schedule
3. Check Calls page (calls created even without Redis)
4. Set `OPENAI_API_KEY` in backend `.env` for live AI summaries

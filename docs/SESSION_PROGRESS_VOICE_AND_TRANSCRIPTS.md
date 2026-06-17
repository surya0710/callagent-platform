# AI Voice Platform — Session Progress Summary

> Handoff prompt / progress record for work completed on bilingual transcripts, training STT, voice session UI, Indian accent tuning, and deployment guidance.

---

## Context: Starting Problem

Live Smartflo voice calls were working well (audio, recording, timeline, opening greeting), but **transcription quality was poor for Hindi + English (Hinglish) calls**. Root cause investigation showed:

- **No live transcript capture** — OpenAI Realtime had no `input.transcription` configured
- **No assistant text capture** — only audio output was handled
- **Recordings were never auto-transcribed** — WAV files saved but not sent to STT
- **Call transcripts** only arrived via placeholder provider webhooks
- **Training uploads** used `whisper-1` by default with minimal Hindi/English prompting

---

## 1. Live Call Transcript System (Hindi / English / Hinglish)

### Architecture

Two-layer transcript pipeline (non-blocking for live audio):

| Layer | Source | Status | When |
|-------|--------|--------|------|
| **Draft** | OpenAI Realtime `input.transcription` + `output_audio_transcript` events | `draft` | During call |
| **Final** | Post-call STT on WAV (+ optional inbound/outbound track WAVs) | `final` | After hangup (background worker) |

Live audio, Smartflo ingestion, outbound playback, and recording timeline logic were **not modified** in ways that affect call quality.

### Key backend additions

- `backend/src/modules/voice/transcript/` — config, prompts, service, post-call STT, post-process cleanup
- `backend/src/common/transcription/bilingual-transcription.util.ts` — shared Hindi/English/Hinglish prompts + glossary
- `backend/src/queues/processors/transcript.processor.ts` — BullMQ job for post-call transcription
- Prisma migration `20250617120000_voice_transcripts` — `CallTranscriptSegment`, lifecycle status fields
- Realtime session config: `input.transcription` with `gpt-4o-mini-transcribe` + bilingual prompt
- Event handlers in `openai-realtime.provider.ts` for customer + assistant transcript events
- Post-call: enqueue after recording finalize in `smartflo-stream.adapter.ts`
- Optional `_inbound.wav` / `_outbound.wav` for speaker-specific post-call STT (mixed WAV unchanged)

### Environment variables (live transcripts)

```env
VOICE_TRANSCRIPT_ENABLED=true
VOICE_TRANSCRIPT_MODE=realtime_and_postcall
VOICE_TRANSCRIPT_LANGUAGE_HINT=hi,en
VOICE_TRANSCRIPT_PRESERVE_HINGLISH=true
VOICE_TRANSCRIPT_REALTIME_MODEL=gpt-4o-mini-transcribe
VOICE_TRANSCRIPT_POSTCALL_MODEL=gpt-4o-transcribe
VOICE_TRANSCRIPT_POSTPROCESS_ENABLED=true
VOICE_TRANSCRIPT_GLOSSARY=TATD,Smartflo,OpenAI,Realtime,AI Voice Calling Platform
```

Modes: `realtime` | `postcall` | `realtime_and_postcall`

### APIs

- `GET /api/calls/:id/transcript` — structured transcript with segments, status, speaker
- `GET /api/voice/sessions/:streamSid/transcript` — draft/final by stream session
- Call detail page shows speaker-labeled segments with auto-refresh while `processing`

### Diagnostics logged

- `transcript_realtime_delta`, `transcript_realtime_completed`
- `transcript_postcall_started`, `transcript_postcall_completed`
- `transcript_postprocess_completed`, `transcript_error`

### Known limitations

- 8 kHz μ-law PSTN limits realtime Hindi/Hinglish accuracy; **post-call is authoritative final**
- Requires `callId` from app-initiated authorization for DB persistence
- Worker (`ai-voice-worker`) + Redis required for queued post-call jobs
- No diarization on mixed-only WAV when separate tracks are empty

---

## 2. Training Upload Transcription Improvements

### Problem

Training audio uploads (English or Hindi) used `whisper-1` with no bilingual prompt → poor Hinglish/name quality.

### Changes

- Default model: **`gpt-4o-transcribe`** (fallback chain includes `gpt-4o-mini-transcribe`, `whisper-1`)
- Bilingual transcription prompt on every STT request
- Optional LLM post-process cleanup after transcription
- Language dropdown on Training page: **English**, **Hindi**, **Hinglish**, **Auto-detect**
- Shared prompt utilities in `backend/src/common/transcription/`

### Environment variables (training)

```env
OPENAI_TRANSCRIPTION_MODEL=gpt-4o-transcribe
TRAINING_TRANSCRIPTION_MODEL=gpt-4o-transcribe
TRAINING_TRANSCRIPT_POSTPROCESS_ENABLED=true
TRAINING_TRANSCRIPT_PRESERVE_HINGLISH=true
TRAINING_TRANSCRIPT_GLOSSARY=TATD,Smartflo,OpenAI
```

(Falls back to `VOICE_TRANSCRIPT_*` settings when training-specific vars omitted.)

---

## 3. Voice Sessions UI — View Transcript

Added on **Voice Sessions** page (`/voice/sessions`):

- **View Transcript** button per session (active + recently ended)
- Modal with status, speaker segments, auto-refresh while `draft`/`processing`
- **View Details** side panel now includes Transcript section + link to full call record
- Frontend: `SessionTranscriptSection.tsx`, `voiceApi.getSessionTranscript()`

---

## 4. Indian Accent Tuning (Live AI Voice)

OpenAI Realtime has no native “Indian voice” preset — accent is steered via **instructions + voice selection**.

### Changes

- `backend/src/modules/voice/voice-accent.util.ts` — `VOICE_ACCENT=indian` (default)
- Concise, stable Indian accent rules in all Realtime session instructions
- Default voice: **`marin`** (was `alloy`); alternatives: `cedar`, `shimmer`, `coral`
- Default opening greeting: **`Namaste`** (configurable via `VOICE_OPENING_GREETING`)
- Indian phrasing guidance in base voice instructions

### Environment variables (accent)

```env
VOICE_RUNTIME=openai-realtime
OPENAI_REALTIME_VOICE=marin
VOICE_ACCENT=indian
VOICE_OPENING_GREETING=Namaste
VOICE_AGENT_NAME=Aisha
VOICE_COMPANY_NAME=TATD
```

Set `VOICE_ACCENT=neutral` to disable Indian accent steering.

---

## 5. Deployment & Operations

### Recommended path: EC2 + PM2 + Nginx

```bash
cd /var/www/ai-voice-platform
git pull origin main
bash ./scripts/deploy.sh
```

Deploy script runs: deps → `prisma migrate deploy` → build → PM2 restart (`ai-voice-api` + `ai-voice-worker`).

### Update env + restart PM2 only

```bash
cd /var/www/ai-voice-platform/backend
nano .env
pm2 startOrReload ecosystem.config.js --update-env
pm2 save
```

### Where to check transcript after a call

1. **UI:** Calls → View → Transcript section
2. **UI:** Voice Sessions → Recent Ended → **View Transcript**
3. **API:** `GET /api/calls/:id/transcript`
4. **API:** `GET /api/voice/sessions/:streamSid/transcript`

Status flow: `none` → `draft` (during call) → `processing` → `final`

### Required services

| Process | Purpose |
|---------|---------|
| `ai-voice-api` | Live calls, Realtime, draft transcripts |
| `ai-voice-worker` | Post-call transcription, summaries |
| Redis | Background job queue |

---

## 6. Complete Production `.env` Checklist

### Core

```env
NODE_ENV=production
DATABASE_URL=mysql://...
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_ENABLED=true
JWT_SECRET=...
CORS_ORIGIN=https://your-domain.com
AI_PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
```

### Live voice (Smartflo + Realtime)

```env
VOICE_RUNTIME=openai-realtime
OPENAI_REALTIME_MODEL=gpt-realtime
OPENAI_REALTIME_VOICE=marin
VOICE_ACCENT=indian
VOICE_WSS_BASE_URL=wss://your-domain.com/api/voice/stream
SMARTFLO_CLICK_TO_CALL_API_KEY=...
SMARTFLO_BASE_URL=https://api-smartflo.tatateleservices.com
SMARTFLO_CALLER_ID=...
VOICE_RECORDINGS_STORAGE_DRIVER=local
VOICE_RECORDINGS_STORAGE_PATH=storage
VOICE_AGENT_NAME=Aisha
VOICE_COMPANY_NAME=TATD
VOICE_OPENING_GREETING=Namaste
```

### Transcripts (live calls)

```env
VOICE_TRANSCRIPT_ENABLED=true
VOICE_TRANSCRIPT_MODE=realtime_and_postcall
VOICE_TRANSCRIPT_LANGUAGE_HINT=hi,en
VOICE_TRANSCRIPT_PRESERVE_HINGLISH=true
VOICE_TRANSCRIPT_REALTIME_MODEL=gpt-4o-mini-transcribe
VOICE_TRANSCRIPT_POSTCALL_MODEL=gpt-4o-transcribe
VOICE_TRANSCRIPT_POSTPROCESS_ENABLED=true
VOICE_TRANSCRIPT_GLOSSARY=TATD,Smartflo,OpenAI
```

### Transcripts (training uploads)

```env
OPENAI_TRANSCRIPTION_MODEL=gpt-4o-transcribe
TRAINING_TRANSCRIPTION_MODEL=gpt-4o-transcribe
TRAINING_TRANSCRIPT_POSTPROCESS_ENABLED=true
TRAINING_TRANSCRIPT_PRESERVE_HINGLISH=true
```

---

## 7. Manual Test Checklist

- [ ] English-only call — live audio OK, draft transcript, final after hangup
- [ ] Hindi-only call — Hindi preserved, not translated to English
- [ ] Hinglish mixed — both languages preserved
- [ ] Indian names / company / phone numbers in transcript
- [ ] Voice Sessions → View Transcript works
- [ ] Calls → View → Transcript shows `final`
- [ ] Training upload with Hindi/Hinglish → Transcribe quality improved
- [ ] AI voice sounds Indian English (not American default)
- [ ] Recording timeline unchanged
- [ ] Worker running: `pm2 status`

---

## 8. Files Changed (Summary)

### New files

- `backend/src/modules/voice/transcript/*`
- `backend/src/common/transcription/bilingual-transcription.util.ts`
- `backend/src/modules/voice/voice-accent.util.ts`
- `backend/src/modules/training/services/training-transcript-postprocess.service.ts`
- `backend/src/modules/training/utils/training-transcription-config.service.ts`
- `backend/src/queues/processors/transcript.processor.ts`
- `backend/prisma/migrations/20250617120000_voice_transcripts/`
- `frontend/src/components/voice/SessionTranscriptSection.tsx`
- `backend/test/voice-accent.util.spec.ts`
- `docs/SESSION_PROGRESS_VOICE_AND_TRANSCRIPTS.md` (this file)

### Modified (high impact)

- `openai-realtime.provider.ts` — transcription events, accent, Indian voice default
- `openai-realtime-ga.util.ts` — `input.transcription` config
- `voice-opening.util.ts` — Indian accent + Namaste default
- `smartflo-stream.adapter.ts` — post-call transcript enqueue, callId bind
- `voice-recording.service.ts` — optional speaker track WAVs
- `calls.service.ts` — structured transcript API
- `openai-training.provider.ts` — gpt-4o-transcribe + prompts
- `VoiceSessionsPage.tsx`, `SessionDetailPanel.tsx`, `CallDetailPage.tsx`, `TrainingPage.tsx`
- `worker.ts`, `queues.module.ts`, `queue.service.ts`
- `prisma/schema.prisma`, `env.validation.ts`, `.env.example`

---

## 9. Prompt for Future AI Sessions

Use this when continuing work on this codebase:

```
You are working on the AI Voice Calling Platform (NestJS + React + Smartflo + OpenAI Realtime).

Stable (do not regress):
- Live Smartflo audio streaming and outbound playback
- Recording timeline and mixed WAV finalize logic
- App-initiated call authorization

Transcript system (implemented):
- Realtime draft via OpenAI input.transcription + output_audio_transcript
- Post-call final via gpt-4o-transcribe on WAV (worker queue)
- Config: VOICE_TRANSCRIPT_* env vars, mode realtime_and_postcall
- APIs: GET /calls/:id/transcript, GET /voice/sessions/:streamSid/transcript
- UI: Call detail + Voice Sessions "View Transcript"

Training STT (implemented):
- gpt-4o-transcribe with bilingual prompts + post-process
- TRAINING_TRANSCRIPTION_* env vars
- Language: en, hi, hinglish on Training page

Voice accent (implemented):
- VOICE_ACCENT=indian, OPENAI_REALTIME_VOICE=marin
- Indian accent instructions in voice-opening.util + voice-accent.util
- Default greeting: Namaste

Before changing audio pipeline, prefer isolated transcript/accent services and async jobs.
Hindi/Hinglish: preserve languages, do not translate unless configured.
Post-call transcript is final; realtime is draft only.
Worker (ai-voice-worker) + Redis required for post-call jobs.
```

---

*Generated as session conclusion — bilingual transcripts, training STT, voice session UI, Indian accent, deployment ops.*

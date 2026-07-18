---
id: TASK-192
aliases:
- TASK-192
title: Voice mode in the frontend — type-to-speak, live mic transcripts, pipeline controls
slug: voice-mode-frontend
status: done
priority: 2
owner: ''
projects: []
customers: []
tags:
- extended
- frontend
- voice
sprint: ''
depends_on: []
due_date: ''
created: 2026-07-18
updated: 2026-07-18
status_note: 'Implemented 2026-07-18: Voice tab on the G1 robot detail page (type a
  message -> robot speaks it via POST /say, live SSE feed of mic transcripts + agent
  replies + pipeline state, mic pause / session reset / speaker volume controls,
  offline degradation banner). Server relays the voice service (:8768) and audio
  adapter (:8766) under /api/robots/:id/voice/*. Verified live end-to-end against a
  mock voice service with Playwright (light + dark, offline/recovery).'
---

## Description

Give the NeoDEM frontend a **voice mode** for the G1: operators type a message and
the robot says it through its speaker, see a running history of the spoken
conversation (typed messages, what the robot microphone heard, what the agent
replied), and control the voice pipeline — all on a new **Voice tab** of the robot
detail page.

## Details

### Current state (before this task)

The entire voice stack (TASK-181) lives in `robot-agent/voice/` (Python): mic →
Silero VAD → faster-whisper STT → A2A agent → Piper TTS → speaker. It exposes an
HTTP control API on **:8768** (`/say`, `/status`, `/health`, `/listen/toggle`,
`/session/reset`, SSE `/events`) and a G1 audio adapter on **:8766**
(`/volume`, `/play`, `/stop`). Nothing in the Node server or React app talked to
it.

### Server — `server/src/routes/voice.routes.ts` (new)

Robot-scoped proxy mounted at `/api/robots` (in `app.ts`, after `robotRoutes`),
so the browser keeps a single origin and the voice service stays LAN-internal:

- `GET  /:id/voice/health` — aggregate `{available, service, adapter}`; always
  200, `available:false` is the frontend degradation signal
- `GET  /:id/voice/status` · `POST /:id/voice/say` (validates text ≤500 chars,
  language de|en) · `POST /:id/voice/listen/toggle` · `POST /:id/voice/session/reset`
- `GET/POST /:id/voice/volume` — proxied to the audio adapter
- `GET  /:id/voice/events` — SSE passthrough (raw `http.get` pipe, upstream
  destroyed on client close; same pattern as the MJPEG camera proxy)

Targets derive from the registered agent host (`http://<agentHost>:8768|8766`);
env overrides `VOICE_SERVICE_URL` / `VOICE_ADAPTER_URL`. Nothing is persisted.

### Frontend (`app/src/features/robots`)

- `types/voice.types.ts` — pipeline states, health/status, SSE event, history entry
- `api/voiceApi.ts` — REST wrappers + `voiceEventsUrl()` for EventSource
- `store/voiceStore.ts` — Zustand store; `applyVoiceEvent()` maps SSE events to
  conversation entries (transcript→heard, reply, error, session_reset divider)
  and low-level mic activity (wake_ignored, transcript_discarded, tts_start …);
  dedups the service's on-connect replay via `lastEventTs`; caps at 200 entries;
  history survives tab switches (session-only, never persisted)
- `hooks/useVoiceChannel.ts` — EventSource with managed 4 s-backoff reconnect
  (browser default would tight-loop against a 502) + 10 s health/status poll
- `components/voice/` — `VoiceStateBadge` (pulsing state pill), `VoiceComposer`
  (textarea, Enter sends, DE/EN SegmentedControl, 500-char cap),
  `VoiceConversation` (auto-following feed; typed right/cobalt, heard dashed
  italic, replies solid, error rows, session dividers, EmptyState),
  `VoicePipelinePanel` (state, mic pause, new session, volume slider, component
  health chips, stt/agent/tts p50 latency, mic-activity log)
- `components/tabs/VoiceTab.tsx` — composition + amber offline banner with start
  hint and Retry; registered in `RobotControlCenter` (G1-gated like Perception)

### Key files

- `server/src/routes/voice.routes.ts`, `server/src/app.ts`
- `app/src/features/robots/{types/voice.types.ts, api/voiceApi.ts, store/voiceStore.ts, hooks/useVoiceChannel.ts}`
- `app/src/features/robots/components/voice/*` and `components/tabs/VoiceTab.tsx`

## Test Strategy

- Unit: `store/__tests__/voiceStore.test.ts` — event mapping, replay dedup,
  paused/state tracking, mic-activity routing, 200-entry cap (8 tests)
- Both typechecks (`server`, `app`) clean; full app suite green
- Live E2E without robot/models: mock voice service + adapter
  (scratchpad `mock_voice_service.mjs`, same API on :8768/:8766) + Playwright:
  say round-trip, live transcripts/replies streaming in, pause/resume, session
  reset divider, volume→adapter, offline banner on kill + auto-recovery on
  restart, history persistence across tab switches, light + dark themes
- On robot day: real check is speaking through the G1 speaker via the validated
  adapter (TASK-181 step 2) with `python -m voice_service` + `run_g1_adapter.ps1`

---
id: "TASK-406"
aliases: []
title: "A data-collection session starts without deciding how many episodes to record"
slug: "a-data-collection-session-starts-without-deciding-how-many"
status: "in-progress"
priority: 1
owner: "huhn511"
projects: []
customers: []
tags: ["core", "datacollection"]
sprint: ""
parent: ""
depends_on: []
spe: 3
effort: "medium"
due_date: ""
created: "2026-10-17"
updated: "2026-10-17"
---

# A data-collection session starts without deciding how many episodes to record

## Description

The "New session" form asks for the number of episodes before anything is recorded. That number gates nothing on the G1, the agent recorder ignores it, yet the UI shows "Episode 3 of 10" and the server falls back to it as the demonstration count. One live session had `numEpisodes: 10` and ended with a single episode.

Sessions become open-ended: you record as many takes as you like and end when you are done. The per-episode length becomes an optional auto-stop instead of a promise the recorder never kept.

## Details

### Current state
- `app/src/features/datacollection/pages/NewSessionPage.tsx`:
  - Episodes field at ~l.291-306, with the hint "You can end early."
  - Validation `intInRange(numEpisodes, 1, 100)` at ~l.130; `numEpisodes` sent at ~l.156 and saved to prefs at ~l.164.
  - "Episode length" field (hint "recording stops after this") at ~l.319-326, validated 5-300 at ~l.131.
- `app/src/features/datacollection/utils/newSessionPrefs.ts` ~l.22-27 defaults `numEpisodes: 10, episodeTimeS: 30, fps: 30`.
- Display of the episode count:
  - `components/SessionHud.tsx:37` ("of N")
  - `components/EpisodePanel.tsx:81,87` ("of N" / "target: N")
  - `SessionDetailPage.tsx` ~l.362, ~l.443
- `server/src/services/TeleoperationService.ts`:
  - `createSession` (~l.133) stores `numEpisodes ?? null` and `episodeTimeS ?? null` (~l.143-144).
  - `startSession` (~l.303-428) sends `num_episodes` / `episode_time_s` only to the SO-101 sidecar (`${sidecar}/record/start`, ~l.325-336), which becomes `lerobot-record --dataset.num_episodes` (`robot-agent/hardware/recorder.py:154`). The agent path passes neither value.
  - `endSession` (~l.682) and `exportToLeRobot` (~l.1329, ~l.1342) fall back to `numEpisodes` for `demonstrationCount` / `trajectoryCount`.
- The SO-101 `recorder.py` stops with SIGINT, which lets lerobot-record finalize the current episode (~l.216-234). A large `num_episodes` cap is therefore safe: the session's End stops it.
- Prisma `TeleoperationSession.numEpisodes Int?` and `episodeTimeS Float?` (`server/prisma/schema.prisma` ~l.1772) stay. No migration.

### Frontend
- **`NewSessionPage.tsx`**
  - Remove the Episodes field and its validation, and stop sending `numEpisodes`.
  - Replace "Episode length" with an optional field under the existing Advanced section, "Stop each take automatically after (s)". It is empty by default (off) and validated 5-600 when set.
  - Hint: "Leave empty to stop takes yourself."
- **`newSessionPrefs.ts`**
  - Drop `numEpisodes`, and make `episodeTimeS` default to `null`.
  - Old stored prefs that still carry `numEpisodes` load without error (ignore the key).
- **`SessionHud.tsx` / `EpisodePanel.tsx` / `SessionDetailPage.tsx` display:** no "of N" and no "target: N". Show `Take N` and `kept K`, where K is the number of listed episodes. Older sessions that have a `numEpisodes` show it nowhere.

### Server
- `startSession`:
  - SO-101 sidecar: `num_episodes: session.numEpisodes ?? 1000`. Send `episode_time_s` only when set, otherwise the sidecar default.
  - Agent recorder: pass `episodeTimeS: session.episodeTimeS ?? null` in the `agentRecordingService.start` request (`AgentRecordingService.start` request type gains the optional field). The agent ignores unknown fields until TASK-402 lands, so this is safe in either merge order.
- `endSession` / `exportToLeRobot`: use counted episodes (`TeleoperationEpisode` rows, else the recorder's result) and never `numEpisodes`.
- `POST /api/teleoperation/sessions` continues to accept `numEpisodes` from old clients and stores it, but nothing reads it for counts.

### Key files
- app/src/features/datacollection/pages/NewSessionPage.tsx (+ test)
- app/src/features/datacollection/utils/newSessionPrefs.ts (+ test)
- app/src/features/datacollection/components/SessionHud.tsx
- app/src/features/datacollection/components/EpisodePanel.tsx (display text only)
- app/src/features/datacollection/pages/SessionDetailPage.tsx (the two "of N" spots only)
- server/src/services/TeleoperationService.ts (startSession sidecar and agent args, endSession and export counts)
- server/src/services/AgentRecordingService.ts (start request type)
- server/src/services/__tests__/TeleoperationService.test.ts

## Decisions
- **D1 No episode count and no "target" field.** The user explicitly does not want to decide this up front. Rejected: an optional target, because nobody would read it and it reintroduces "of N".
- **D2 SO-101 gets an internal cap of 1000.** lerobot-record needs a number, and End finalizes cleanly. Rejected: keeping the count field for SO-101 only, which means two forms for one flow.
- **D3 Per-take auto-stop is optional and off by default.** The recorder honours it once TASK-402 lands. Its label no longer promises behaviour the recorder lacks.
- **D4 "Take N" is the UI word.** It is 1-based and matches what TASK-408 and TASK-410 build.

## Implementation decisions
- **I1 Old "Episode length" prefs are not carried over.** The remembered auto-stop is stored under a new key, `autoStopS`. A stored `episodeTimeS` from the old form was an "episode length" the G1 recorder never honoured; reading it back would silently turn it into a real auto-stop once TASK-402 lands. Old `numEpisodes` is ignored too.
- **I2 The agent start request carries `episodeTimeS` only when set**, instead of `episodeTimeS: null` when unset. Absence means the same thing and leaves the request body of an unset session unchanged for agents of any version.
- **I3 Counted episodes:** `endSession` uses the recorder's count, else the session's `TeleoperationEpisode` rows, else 1. The SO-101 export path uses the rows, else the `demonstrationCount` of the dataset created when the session ended, else 1.
- **I4 HUD wording:** the take tile reads `Take N` with `kept K` as its unit; the episode panel reads `Recording take N · kept K` while recording and `Kept K takes` otherwise.

## Acceptance Criteria
- [ ] The New session form has no episode count. A session created through it has `numEpisodes: null` and `episodeTimeS: null` unless auto-stop is set.
- [ ] Old prefs with `numEpisodes` load without error.
- [ ] No "of N" or "target" text remains anywhere in the datacollection feature (`grep -rn "of {" …` check plus component tests).
- [ ] A session with `numEpisodes: 10` and 1 recorded episode ends with `demonstrationCount: 1`.
- [ ] The SO-101 sidecar start body carries `num_episodes: 1000` when the session has none (server test with the sidecar fetch mocked).
- [ ] The agent start request carries `episodeTimeS` when set.
- [ ] `npx tsc` (app), `npm run typecheck` (server), and the vitest suites for the touched files pass.

## Test Strategy
- **vitest:**
  - app: NewSessionPage renders without the field and submits without `numEpisodes`; prefs migration; HUD and EpisodePanel text.
  - server: startSession sidecar and agent bodies with fetch mocked; endSession and export counts.
- **Playwright (demo build with MSW):** update any spec that fills the episodes field.
- No robot needed.

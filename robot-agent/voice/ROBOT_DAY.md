# Robot day — voice on the real G1 EDU (TASK-181)

Run sheet for validating the voice service against the physical robot.
Background and the "why" live in `README.md`; the acceptance criteria live in
`.mc/tasks/todo/TASK-181-voice-g1-real-robot-validation.md`. This file is the
order of operations.

**Scope:** microphone in, speaker out, LEDs. No motion, no `rt/lowcmd`, no
DDS domain other than 0. The Stage-1 read-only directive from TASK-169 holds.

## 0. Before the robot arrives (doable now)

Everything except step 1 is already done and verified on this box: both venvs
exist, the adapter mock-smoke-tests clean, 79 unit tests pass, Ollama serves
`gpt-oss:20b`, and the Piper/Silero models are on disk.

**Step 1 — firewall (needs an ADMIN PowerShell, once per machine).** Without
it Windows silently drops the robot's mic multicast and the pipeline just
never hears anything:

```powershell
New-NetFirewallRule -DisplayName "NeoDEM voice G1 mic (UDP 5555)" `
  -Direction Inbound -Protocol UDP -LocalPort 5555 -Action Allow `
  -Program "C:\Unitree\robot-management-system\robot-agent\voice\.venv\Scripts\python.exe"
```

Verify: `Get-NetFirewallRule -DisplayName "NeoDEM voice G1 mic (UDP 5555)"`.

> The rule is bound to the voice venv's `python.exe`. `scripts/g1_mic_dump.py`
> and `g1_preflight.py` run in that same venv under `uv run`, so one rule
> covers all three.

## 1. Power-up order

1. G1 EDU on, wait for PC2 (`ping 192.168.123.164` replies). The "Ethernet 3"
   NIC is statically 192.168.123.10/24 — it just shows Disconnected until the
   robot LAN link is up.
2. Ollama serving; `cd robot-agent && npm run dev:g1-edu` (A2A on `:41244`).
3. Adapter: `.\scripts\run_g1_adapter.ps1` (real robot, DDS domain 0).
4. `uv run python scripts/g1_preflight.py` — every check must pass.
5. For the NeoDEM Voice tab (section 4): `cd server && npm run dev` (`:3001`)
   and `cd app && npm run dev` (`:1420`).

## 2. The eight steps

| # | What | Command / check |
|---|---|---|
| 1 | Firewall | see step 0 above |
| 2 | Adapter bring-up | `.\scripts\run_g1_adapter.ps1`; `GET :8766/health` shows `"mock": false`; then `scripts/g1_say.py` (below) for audible speech, `/volume`, `/stop` |
| 3 | Mic capture | `uv run python scripts/g1_mic_dump.py --seconds 15` → WAV + level/clipping report |
| 4 | Full round trip | `uv run python -m voice_service --env-file .env.voice.g1`, then speak DE + EN from 1–3 m, multi-turn |
| 5 | Half-duplex | robot must not re-trigger on its own voice; tune via `POST :8768/config` |
| 6 | Latency | `GET :8768/status` p50/p95 vs PC baseline (stt ≈ 0.3 s, agent ≈ 1.2 s, tts ≈ 0.4 s) |
| 7 | Conflicts | Unitree's built-in `vui` assistant must not hold the speaker; the lowstate DDS bridge must survive (same domain 0) |
| 8 | LEDs (optional) | `POST :8766/led` — listening=green, thinking=blue, speaking=white |

### Step 2 — speak out of the robot

`g1_say.py` is the quick way: Piper → resample → `POST /play`, the same output
leg the voice service uses, so a pass proves the speaker path on its own (no
mic, no LLM). It warns if the adapter is in mock mode instead of silently
"succeeding".

```powershell
uv run python scripts/g1_say.py "Hallo, ich bin ein Roboter."   # auto de/en
uv run python scripts/g1_say.py "Hello Florian" --lang en
uv run python scripts/g1_say.py "Eins zwei drei vier ..." --stop-after 2  # verify /stop cuts
uv run python scripts/g1_say.py --volume 60                     # set speaker level
```

`/play` returns when the SDK *drained* the audio, which is not proof it was
audible — trust your ears. If it reports 200 but nothing comes out, that is the
`vui` conflict (step 7).

Lower-level fallback (raw WAV body):

```powershell
uv run python scripts/smoke_tts.py          # writes out/smoke_tts_de.wav
# strip the 44-byte WAV header — /play takes raw 16k mono s16le PCM
$wav = [System.IO.File]::ReadAllBytes("out\smoke_tts_de.wav")
$pcm = $wav[44..($wav.Length - 1)]
Invoke-WebRequest -Uri http://localhost:8766/play -Method Post -Body $pcm `
  -ContentType application/octet-stream
```

### Step 5 — tuning without a restart

`VOICE_VAD_THRESHOLD` and `VOICE_HALF_DUPLEX_TAIL_MS` are runtime-mutable, so
tune between utterances instead of restarting (a restart reloads Whisper):

```powershell
Invoke-RestMethod -Uri http://localhost:8768/config -Method Post `
  -ContentType application/json -Body '{"vad_threshold": 0.6, "half_duplex_tail_ms": 400}'
```

Raise the threshold first, then the tail. If the array still hears the robot's
own speaker through the chassis, fall back to `{"mode": "ptt"}` and gate with
`POST :8768/listen/toggle` — that always works and is a fine demo mode.

Watch what the pipeline is doing live: `curl -N http://localhost:8768/events`
(SSE — state, transcript, reply, `wake_ignored`, errors).

## 2b. NeoDEM Voice tab (TASK-192 / PR #203)

Once step 4 (full round trip) works from the terminal, validate the same thing
through the product UI. The server proxies `/api/robots/g1-edu-4/voice/*` to
the voice service (`:8768`) and adapter (`:8766`) — no extra config needed as
long as agent, voice service and adapter run on this box.

1. Open `http://localhost:1420/robots/g1-edu-4` → **Voice** tab.
2. Health chips must show STT/TTS/Agent green and the adapter chip **without**
   a mock flag; the offline banner must NOT be showing.
3. Type a message (DE and EN via the toggle), press Enter → audible from the
   robot speaker; the entry appears right-aligned as "Spoken by robot".
4. Speak to the robot → transcript ("Robot heard") and the agent's reply
   stream into the feed live; the state badge cycles
   listening → capturing → thinking → speaking.
5. **Pause mic** stops new transcripts; **New session** inserts a divider and
   resets the A2A context (follow-up questions lose prior context).
6. Volume slider → robot speaker gets audibly louder/quieter (this is the
   adapter `/volume` DDS round-trip validated 2026-07-17).
7. Kill nothing — but if the voice service dies mid-demo the tab must degrade
   to the amber offline banner and auto-recover on restart (verified against
   the mock; nice to confirm once on the real stack).

## 3. Sign-off (from the task's Test Strategy)

- [ ] `/health` ok; `/play` audible; `/stop` cuts within ~1 s
- [ ] 5 DE + 5 EN turns at 1–3 m, ≥ 9/10 correct transcripts, no self-trigger
- [ ] multi-turn: follow-up answered with context; "Neues Gespräch" resets
- [ ] 15 min open-mic soak: no crash/stall, `/health` stays ok, VRAM stable

## Troubleshooting

| Symptom | Cause |
|---|---|
| No transcripts, no errors | Firewall (step 0) — confirm with `g1_mic_dump.py`; it reports "NO PACKETS" rather than hanging |
| Packets arrive, stream silent | Robot mics muted, or `vui` holds the array — check step 7 |
| `/play` 409 busy | A previous playback still holds the lock; `POST /stop` |
| `/play` audible on PC, not robot | Adapter started with `G1_AUDIO_MOCK=1` — preflight flags this |
| Adapter import errors | Wrong venv. It must be `C:\Unitree\.venv-g1-audio` (3.10). The 3.12 voice venv has no cyclonedds wheels — that is why the adapter is a separate process |
| Robot answers passing chatter | Wake phrase disabled — `.env.voice.g1` ships `hey g1,hallo g1` on |

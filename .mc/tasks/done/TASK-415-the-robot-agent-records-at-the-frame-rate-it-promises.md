---
id: TASK-415
title: The robot agent records at the frame rate it promises
status: done
priority: 2
owner: huhn511
created: 2026-10-18
updated: 2026-10-18
tags: [core]
spe: 5
depends_on: []
---

# The robot agent records at the frame rate it promises

## Description

Since TASK-402, datasets store an integer `fps` (e.g. 30), but the agent's recorder often reaches far less. Live checks on the sim stack measured 10.6–15 fps against a 30 fps target, and filled the rest with "behind" drops or repeated frames. A dataset that says 30 fps but holds 11 fps of distinct samples trains a policy on the wrong timing. Find the cause and fix it, so a sim recording reaches ≥ 28 fps of distinct state samples on this box.

## Details

### Current state
- `robot-agent/src/recording/EpisodeRecorder.ts`: deadline tick scheduler (TASK-402). It reads state and action from the sidecar every tick and the camera frame from the camera source.
- TASK-402's implementer measured Node `fetch` from the agent to the sim sidecar's `GET /state/fast` at **~43 ms per request**, versus **~0.5 ms with curl**. The ~40 ms figure is the classic signature of Nagle's algorithm plus delayed ACK, or of a new TCP connection per request: a Python `http.server`/`BaseHTTPRequestHandler` that answers HTTP/1.0 or closes the connection, combined with undici's keep-alive or pipelining behaviour. It is unproven which one applies.
- The sidecars are `robot-agent/hardware/sim_g1_dds/sim_node.py` (HTTP facade) and `robot-agent/hardware/g1_sidecar.py`. Check how both serve HTTP (`protocol_version`, `TCP_NODELAY`, `Connection` headers, threading).
- The first real-robot recording on 2026-10-17 reached 30.21 fps with a constant dt, so the real sidecar path may be fine. Measure both code paths: the real one only offline or with unit tests, because the robot is off-limits.
- The HTTP client is in `robot-agent/src/hardware/HardwareClient.ts`. Check how `/state/fast` is fetched (undici `fetch`, agent, keep-alive).

### Robot Agent / Hardware
1. Reproduce: a small benchmark script (scratchpad, not committed unless useful as a test) timing 200 sequential `/state/fast` requests from Node against a sim sidecar on your reserved port.
2. Fix at the right layer. Options:
   - set `protocol_version = "HTTP/1.1"` with correct `Content-Length` in the Python handlers;
   - set `TCP_NODELAY` on accepted sockets (`ThreadingHTTPServer` with a custom `server_bind`/`get_request`);
   - use a keep-alive undici `Agent` in HardwareClient.

   Prefer the sidecar-side fix if it is the cause; it also helps every other client.
3. Make the recorder's status and quick-check report **distinct** samples per second, not ticks, if they differ today, so the quick check's "dropped frames" warning reflects reality.
4. Python must stay 3.9-compatible (`tests/test_fstring_portability.py`).

## Acceptance criteria
- Node → sim sidecar `/state/fast` median latency is < 5 ms on this box. Show the benchmark numbers before and after in the PR.
- A 20 s sim recording via the agent at 30 fps target yields `fpsActual` ≥ 28 and < 5 % dropped frames, with the user's dev stack running at the same time.
- The g1_sidecar.py HTTP server gets the same fix if it shares the cause, covered by a unit test (e.g. the server's protocol_version / TCP_NODELAY are set).
- Existing hardware pytest and robot-agent vitest suites pass.

## Test Strategy
- Unit: pytest for the HTTP server settings; vitest for any HardwareClient change.
- Live (sim only, your reserved ports and DDS domain on lo): benchmark plus a recording through the agent's recording routes. Never the real robot, never domain 0.

## Safety constraints
Never set G1_READ_ONLY=0; never kill -9 a sidecar; no DDS publishing on domain 0; the real robot is off-limits.

## Implementation notes (2026-10-18)

**Cause, proven:** Nagle's algorithm plus delayed ACK on the sim facade's keep-alive connections. `sim_node.py`'s handler is HTTP/1.1, and `_send` writes the headers (`end_headers()`) and the body as two segments; Nagle held the body until the client ACKed the headers, which a delayed-ACK client does ~40 ms later. Node's pooled `fetch` hit it on every other request. curl never did because each run opens a fresh connection (quick-ACK mode). Not undici, not a new connection per request.

**Fix:** `disable_nagle_algorithm = True` on both handlers (`StreamRequestHandler.setup()` then sets `TCP_NODELAY` on every accepted socket; available on Python 3.8+). No HardwareClient transport change was needed.

**Measured on this box** (200 sequential `GET /state/fast` from Node `fetch`, branch sim on :8815, the user's dev stack running):

| | median | p90 | mean | requests > 20 ms |
|---|---|---|---|---|
| before (fix switched off) | 2.61 ms | 43.22 ms | 22.33 ms | 100/200 |
| after | 1.82 ms | 2.63 ms | 1.93 ms | 0/200 |

20 s recording through the agent's recording routes, 30 fps target, joints only:

| | frames | dropped | fpsActual | quick check |
|---|---|---|---|---|
| before (fix switched off) | 303 | 296 (49 %) | 15.2 | `dropped_frames` |
| after (two runs) | 600 | 0 | 30.0 | none |

`g1_sidecar.py` measured offline (no DDS) at 0.60 ms median: it answers HTTP/1.0 and closes after each reply, which flushes the held segment, so it does not share the cause today. It gets the same one-line fix as insurance against a future move to keep-alive, with a unit test.

**Distinct samples:** the recorder now reads `/state/fast` through `HardwareClient.getMeasuredSample()`, which carries the sim's `sim_time`. A kept frame whose `sim_time` equals the previous frame's is counted as `repeated` (per episode, `totalRepeated` in status, `_neodem.repeatedFrames` in the dataset). `fpsActual` is distinct samples per second, and the quick check counts repeats with drops against the 5 % `dropped_frames` threshold. Repeated frames are kept, not dropped, so the camera sequences stay contiguous.

**Deviations:**
- The live recording ran with `cameras: []`. MuJoCo EGL rendering crashes inside this agent's sandbox (llvmpipe core dump, also in a standalone render test), so camera snapshots could not be exercised live; the `/state/fast` path the fix targets was.
- The real sidecar reports no sample clock (`timestamp` is the reply time), so repeats are never claimed there; lowstate arrives at 500 Hz, far above any recorder rate.

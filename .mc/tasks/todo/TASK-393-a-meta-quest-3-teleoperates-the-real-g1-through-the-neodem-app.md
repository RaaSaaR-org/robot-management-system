---
id: "TASK-393"
aliases: []
title: "A Meta Quest 3 teleoperates the real G1 through the NeoDEM app"
slug: "a-meta-quest-3-teleoperates-the-real-g1-through-the-neodem-app"
status: "review"
priority: 1
owner: "huhn511"
projects: []
customers: []
tags: ["core", "g1", "teleop", "vr", "safety"]
sprint: ""
parent: "[[TASK-169]]"
depends_on: []
spe: 8
effort: "high"
due_date: "2026-10-18"
created: "2026-10-17"
updated: "2026-10-17"
---

# A Meta Quest 3 teleoperates the real G1 through the NeoDEM app

## Description

On 2026-10-16 the real G1 EDU (+Dex3-1) was teleoperated with a Meta Quest 3 using
Unitree's own `xr_teleoperate`, outside NeoDEM — nothing was recorded. This task makes
the NeoDEM path (Quest browser → app → server → robot-agent → `g1_sidecar.py` → robot)
work end to end on the real robot, so the team can collect real LeRobot datasets on
2026-10-18. It is the agent/server/app half; the sidecar's arm-only write mode is
TASK-391, built in parallel against the shared contract below.

## Details

### Current state (verified 2026-10-16/17)

1. **The lease never binds.** The server hands out control leases by default
   (`server/src/config/features.ts`), the app sends `{bind}` on the teleop socket, but
   `robot-agent/src/api/keyboard-teleop.ts` ignores `{bind}` unless
   `CONTROL_LEASE_REQUIRED=true` and never answers `bound` — so "Take control" times out
   and `canEnterVr` in `VRTeleopModal.tsx` stays false.
2. **The browser connects straight to the agent** (`vrUrls.ts` `getWsBaseUrl` →
   `a2aAgentUrl`). That breaks over `adb reverse` (only the page port is reversed),
   Tailscale, and HTTPS (mixed content). The dev A2A socket
   (`app/src/shared/utils/websocket.ts`) likewise hard-codes `ws://<host>:3001`.
3. **The forwarder sends all 43 joints, legs included**
   (`RobotStateManager.forwardTeleopToHardware` → `hardwareClient.sendAction`).
4. **No arm dead-man.** The socket pings every 15 s and never checks the pong.
5. **No arming.** Nothing calls the sidecar's `/arm` / `/disarm`; `releaseAction()` posts
   `/estop`, which in the new sidecar contract LATCHES.
6. **The Quest connection is manual** (adb reverse + SSH tunnel); the app's hint covers
   only the `adb reverse` step.
7. **Recording on the real robot:** the recorder stores the teleop map, not what reached
   the sidecar; it does not notice a read-only sidecar; a missing Dex3 hand makes
   `start()` 409 on 7–14 missing joints; provenance is hard-coded `simulated: true`.

### Shared contract with TASK-391 (sidecar)

- `G1_WRITE_MODE=arm_sdk` opt-in; default stays read-only. In `arm_sdk` the sidecar
  publishes `rt/arm_sdk` (14 arm joints only) and Dex3 `HandCmd` for hands with state.
- `POST /arm {"lease_generation": <int|null>}` ramps weight 0→1 over ~1.5 s from the
  measured arm pose; `POST /disarm` ramps 1→0 over ~1 s; `POST /estop` disarms and
  latches until `POST /estop/reset`; `POST /action` → 409 `{"error":"not_armed"}` unless
  armed; leg/waist keys ignored.
- Sidecar dead-man: no `/action` for 0.5 s → hold; 1.0 s → disarm ("deadman").
- `GET /health` and `/state` carry `write_mode`, `armed`, `arm_weight`, `estop_latched`,
  `hands: {left, right}`, `teleop_mode` (`arms+hands` | `arms+left_hand` |
  `arms+right_hand` | `arms_only`).

### Robot Agent

- `keyboard-teleop.ts`: always honour `{bind}` when a lease is installed (the env flag
  stays a *require* switch); a socket that bound once stays lease-gated. New `{hb}`
  heartbeat frame; after 1 s of silence from a socket that heartbeats, its motion is
  halted, its arm claim released (→ disarm) and it is told `heartbeat_lost`.
- New `src/teleop/arm-registry.ts`: one arm claim per engaged socket. The first claim on
  an `arm_sdk` sidecar POSTs `/arm` with the lease generation; the last release POSTs
  `/disarm`. Arming needs a bound lease and a live heartbeat. E-stop, lease fence,
  heartbeat loss and socket close all release. Pushes `{type:'arm', …}` frames (write
  mode, armed, arm_weight, teleop_mode, hands) to every teleop socket.
- `HardwareClient`: parse the arm fields from `/health` + `/state`; `arm()`, `disarm()`,
  `resetEstop()`; `releaseAction()` → `/disarm` on an `arm_sdk` sidecar (legacy `/estop`
  otherwise); `mayStreamAction()` gates the forwarder until armed.
- `state.ts`: the forwarder sends only arm + Dex3 joints on a G1 (skips a hand the
  sidecar reports absent), remembers what it actually sent; the E-stop reset clears the
  sidecar latch (`/estop/reset`).
- Recorder: `action` = the targets actually sent (fresh within 250 ms) when a sidecar is
  attached; refuses to start against a read-only real sidecar; a missing hand records
  arms-only / one-hand with a distinct `robot_type` and the mode in provenance;
  provenance says real vs sim.

### Server

- Same-origin teleop proxy `GET /api/robots/:id/teleop/ws` (WebSocket) →
  agent `/ws/keyboard-teleop`, authenticated with the user's access token in the
  `Sec-WebSocket-Protocol` header (`neodem.teleop`, `bearer.<token>`; never in the URL),
  tenant-checked, `AGENT_MEMORY_TOKEN` towards the agent. `setupWebSocket` moves to
  `noServer` + one upgrade dispatcher so both endpoints share port 3001.

### Frontend

- `vrUrls.ts`: `getTeleopSocketUrl(robot)` → same-origin proxy by default; direct mode via
  `VITE_TELEOP_DIRECT=true`. Used by the VR modal, keyboard teleop and session-page inputs.
- `websocket.ts`: dev default is same-origin `/api/a2a/ws` through the Vite proxy.
- `vite.config.ts`: proxy target overridable (`VITE_PROXY_TARGET`).
- `VrTeleopRig.tsx`: sends `{hb}` at 10 Hz while it may stream.
- `VRTeleopModal.tsx` + VR HUD: arm state (`armed`, weight), `teleop_mode` warnings
  (arms-only / one hand) — a warning, not a blocker.
- "Connect Meta Quest" helper (`QuestConnectHelp.tsx`) in the VR panel; `vrAvailability.ts`
  hints point at `scripts/quest-connect.sh`.

### Scripts / docs

- `scripts/quest-connect.sh`: finds adb (PATH or `~/.local/opt/platform-tools/adb`),
  checks the device is authorised, `adb reverse tcp:1420 tcp:1420`, `--list`, optional
  wireless (`--wireless`).
- `docs/vr-teleop-data-collection.md`: "Quest 3 on the real G1 via NeoDEM" runbook.

### Key files

- `robot-agent/src/api/keyboard-teleop.ts`
- `robot-agent/src/teleop/arm-registry.ts` (new), `robot-agent/src/teleop/forward-joints.ts` (new)
- `robot-agent/src/hardware/HardwareClient.ts`, `robot-agent/src/hardware/arm-status.ts` (new)
- `robot-agent/src/robot/state.ts`
- `robot-agent/src/recording/EpisodeRecorder.ts`, `dex3-layout.ts`, `recording-controller.ts`, `lerobot-writer.ts`
- `server/src/websocket/index.ts`, `server/src/websocket/teleopProxy.ts` (new),
  `server/src/websocket/teleopProxyRoute.ts` (new), `server/src/index.ts`
- `app/src/features/robots/components/tabs/vr/{vrUrls.ts,vrAvailability.ts,VRTeleopModal.tsx,VrTeleopRig.tsx,vrHud.ts,QuestConnectHelp.tsx}`
- `app/src/features/robots/components/tabs/vr/VRTeleopSection.tsx` (hosts the Quest helper, which
  `VRSessionPanel.tsx` renders unchanged), `app/src/features/robots/components/tabs/TeleopTab.tsx`
- `app/src/features/datacollection/hooks/{useSessionControlLease,useGamepadJoints,useSimulatedVrInput}.ts`
- `app/src/shared/utils/websocket.ts`, `app/vite.config.ts`
- `scripts/quest-connect.sh` (new), `docs/vr-teleop-data-collection.md`

## Acceptance Criteria

- [x] With leases advertised by the server and `CONTROL_LEASE_REQUIRED` unset, `{bind}`
      with a valid lease answers `{type:'lease', state:'bound'}`; an invalid one answers
      `lease_invalid`; a bound socket loses motion on fence/expiry.
- [x] The VR modal connects through `/api/robots/:id/teleop/ws` by default; with auth on,
      a socket without a valid token is refused before the upgrade; added latency measured.
- [x] In dev the A2A socket uses same-origin `/api/a2a/ws`; only port 1420 needs
      `adb reverse`.
- [x] On a G1 / G1 EDU the forwarder never sends a leg or waist joint.
- [x] A heartbeating socket that goes silent for 1 s is halted and its arm claim released
      (sidecar `/disarm`), and the client is told `heartbeat_lost`.
- [x] On an `arm_sdk` sidecar: engaging under a bound lease with a live heartbeat POSTs
      `/arm` with the lease generation before any `/action`; teleop end, E-stop, lease
      loss and heartbeat loss POST `/disarm`; E-stop reset POSTs `/estop/reset`; no
      `/action` is sent while disarmed.
- [x] Without a bound lease an `arm_sdk` sidecar is never armed (`arm_requires_lease`).
- [x] On an `arm_sdk` sidecar the agent calls `/arm` only after it has seen the console's
      clutch (`{hb, clutch}`) released and then squeezed again since the socket opened and
      since the last disarm the operator did not cause (E-stop + reset, heartbeat loss,
      lease loss/takeover, sidecar dead-man / 409, refused `/arm`); an edge made while
      arming is blocked does not count; a console that reports no clutch cannot arm. The
      HUD and the desktop tag say *Release grip to re-arm* while the grip is still held.
- [x] On an `arm_sdk` sidecar a side whose clutch is open is never driven, so tracked hands
      (no clutch) never arm or drive the real arms (`arm_side_unclutched`); the HUD and the
      VR panel say *Use controllers to drive the real robot*. The sim is unchanged.
- [x] The VR panel and HUD show armed / arm weight and warn (not block) on
      `arms_only` / one-hand `teleop_mode`.
- [x] The VR panel has a "Connect Meta Quest" helper; `scripts/quest-connect.sh` sets up
      `adb reverse` and reports an unauthorised device clearly.
- [x] The recorder stores what was sent to the sidecar, refuses a read-only real sidecar,
      records arms-only / one-hand when a hand is missing and says so in the metadata.
- [x] Typecheck + vitest green in robot-agent, server and app.

## Test Strategy

- Vitest: `keyboard-teleop-lease.test.ts` (bind without the require flag),
  new `keyboard-teleop-arming.test.ts` (heartbeat, arming against a fake sidecar),
  `arm-registry.test.ts`, `state-teleop-forwarding.test.ts` (G1 joint filter, gating),
  `HardwareClient` arm fields, `EpisodeRecorder` (sent targets, read-only refusal,
  arms-only layout), server `teleopProxy.test.ts` (auth, tenant, piping),
  app `vrUrls`, `websocket`, `vrAvailability`, `QuestConnectHelp` tests.
- Manual / scripted: own agent on a free port against a fake contract sidecar (and the
  MuJoCo DDS sim on domain 1 / `lo`), own server on a free port, a Node WebSocket client
  that mimics `VrTeleopRig` through the proxy; measure direct vs proxied RTT.
- Real robot (2026-10-18, needs TASK-391): runbook in `docs/vr-teleop-data-collection.md`.

## Notes

- 2026-10-17 implementation evidence (branch
  `feat/task-393-a-meta-quest-3-teleoperates-the-real-g1-through-the-neodem`):
  - Gates: robot-agent typecheck + vitest 2614/2614; app tsc + vitest 2865/2865; server
    typecheck + vitest 7045 pass, 3 fail in `ScanSessionService.test.ts`
    (`StorageUnavailableError`) — fails identically with this diff stashed, so not caused here.
  - End to end on loopback, own processes only: a fake contract sidecar (:8791) → own agent
    (:41251, `g1_edu`) → the real `createTeleopProxy` (:3011) → own Vite dev server (:1431,
    `VITE_PROXY_TARGET`). A client that mimics `VrTeleopRig` bound the lease, heartbeated at
    10 Hz and streamed poses: `/arm` with the lease generation came before the first `/action`;
    0 leg keys in 1080 `/action`s; stopping the heartbeat disarmed in ~1 s and the client was
    told `heartbeat_lost`; resuming re-armed; closing disarmed. A recording with the right hand
    absent wrote 58 frames, `observation.state` shape [21], `robot_type`
    `Unitree_G1_Dex3_LeftHand`, `_neodem.source = neodem-real-teleop`, `simulated: false`.
  - Against an own MuJoCo DDS sim (domain 1, `lo`, :8781) through own agent + proxy: no
    arming (sim advertises no write mode), arm joints followed, legs and the untouched arm held.
  - RTT `{positions}` → `{type:'state'}` (loopback, n = 103): direct p50 0.31 / p95 0.50 ms,
    server proxy 0.56 / 0.97 ms, Vite + server proxy 0.92 / 1.52 ms.
  - The A2A socket through the Vite proxy answered `connected` from the running dev server.
  - Found by the e2e run and fixed: a protective stop that clears on its own left the sidecar's
    `/estop` latch set, so the arms could never be armed again; the clear edge now resets it.
- 2026-10-17 safety fix (after the robot-day integration run showed the sidecar going from
  latched to `arming` within 0.5 s of an E-stop reset with no fresh grip): new
  `robot-agent/src/teleop/reengage.ts` latch per teleop socket, enforced in
  `keyboard-teleop.ts` (agent side of the socket); the VR rig and the keyboard tab report
  their clutch on every heartbeat and at once on a change; HUD / desktop tag / VR panel
  show *Release grip to re-arm* and *Use controllers to drive the real robot*. TASK-391's
  sidecar contract is unchanged.
  - Vitest: `reengage.test.ts` (11), `keyboard-teleop-arming.test.ts` (23, 9 new — first
    arm needs a release, E-stop reset with grip held incl. an edge made during the latch,
    own E-stop, heartbeat loss, lease takeover, sidecar dead-man, refused `/arm`, tracked
    hands, mixed controller + hand, no-clutch client), app `vrHud`, `VRTeleopModal`,
    `KeyboardTeleopLease` (clutch frames around the key press). Disabling the edge check
    fails 7 of the agent tests.
  - End to end, own processes only, MuJoCo DDS sim + TASK-391 sidecar (`arm_sdk`) + this
    branch's agent on DDS domain 42 / `lo` (:8782 / :8792 / :41252), a Node client that
    mimics the rig (`{hb, clutch}` 10 Hz, poses 20 Hz only while gripped), 17/17:
    grip held from connect → stays disarmed 2 s; release → squeeze arms (1.6 s to weight 1);
    platform E-stop → reset with the grip held, after a release+squeeze made DURING the
    latch → sidecar stays `disarmed`/0 for 3 s of poses; release → squeeze re-arms;
    heartbeat stall → disarmed in ~2.0 s, link back with grip held → stays disarmed 3 s,
    release → squeeze re-arms; agent SIGSTOP → sidecar dead-man (`last_disarm_reason
    deadman`), SIGCONT with grip held → stays disarmed 3 s, release → squeeze re-arms;
    letting go while armed keeps the arms armed; tracked hands only (clutch open) → never
    armed in 3 s, `arm_side_unclutched`.
- Not verified here: anything on the real robot (needs TASK-391's `G1_WRITE_MODE=arm_sdk`),
  a real Quest browser, auth-enabled mode end to end (unit-tested only).
- 2026-10-17 adversarial review of the re-arm fix: two holes in `teleop/arm-registry.ts`, both
  fixed with tests. (1) A claim outlived the arm it was made for until its socket's next
  33 ms tick, so another console's fresh squeeze arming the sidecar in that window made the
  first console's stale claim live again — it drove without a fresh edge. A fresh `/arm` now
  drops every other claim left on the books. (2) A claim refused during the `/arm` cooldown
  was recorded anyway and never released, so a later console's arm stayed up after that
  console left. A refused claim is no longer recorded. `arm-registry.test.ts` +2,
  `keyboard-teleop-arming.test.ts` +2; all four fail without the fix.

- Needs TASK-391's sidecar `arm_sdk` mode to move the real robot; until then an
  `arm_sdk`-less sidecar behaves exactly as before (no arming, legacy release).

- 2026-10-17 review (`/review`, range `origin/main...HEAD` from `cd3c8f04`), checked
  against TASK-391's sidecar on PR #417 (`g1_arm_sdk.py`): `/arm` (idempotent while
  engaged, 409 `estop_latched`, 503 `no_state`), `/disarm`, `/estop` (latches),
  `/estop/reset`, `/action` (partial dicts, 409 `not_armed`, leg/waist ignored), and the
  `/health` + `/state` fields all match what the agent sends and parses. Fixed in review:
  - A held key kept integrating its target after the sidecar disarmed itself (its
    dead-man or a 409), and the next frame's re-arm shipped the whole drift at once. The
    tick now drops held-key velocity while `ArmRegistry.isLive()` is false.
  - A `/health` or `/state` read already on the wire when `/arm` landed could report
    `armed: false` and stop the forwarder of a freshly armed sidecar. Status reads are now
    dropped when an arm-path transition overtook them (`armOpSeq`).
  - `{preset:'home'}` is refused on an `arm_sdk` sidecar (`home_unavailable`, every
    press): the all-zeros pose swings a real G1's arms forward.
  - Runbook: the `arm_sdk` sidecar refuses to start without `G1_DDS_DOMAIN`; the
    bring-up line now sets `G1_DDS_DOMAIN=0` and points at TASK-391's procedure; the
    headset-on-another-computer case (one `ssh -L 1420`) is written down.

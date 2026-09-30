# TASK-336 — roboctl move does not move a sidecar-backed robot

**Date:** 2026-09-30
**Task:** `.mc/tasks/todo/TASK-336-roboctl-move-does-not-move-a-sidecar-backed-robot.md`

Immutable once committed. Later changes of mind get their own record.

## How this was decided

Decided by the lead of the 2026-09-30 workflow run, on behalf of the owner
(huhn511), and handed to the implementing agent as a fixed decision. The
implementation details below (Q2–Q5) were chosen by the implementing agent inside
that decision and are marked as such.

## Facts established before deciding

| Fact | Why it mattered |
| ---- | --------------- |
| `CommandExecutor.moveTo` only sets `targetLocation` + `busy` and returns success at once | the command said `completed` in 1 ms |
| The only consumer of `targetLocation` is `SimulationEngine.updatePosition` — a kinematic pose | with a sidecar the pose comes from odometry, so nothing walks |
| Agent Mode's `goto {place}` walks the MuJoCo G1 into `CHARGING-A` over `LocoClient`, with the place graph and the keepout check | the locomotion path exists and is proven |
| `assessFrameRegistration` (`place-frame.ts`) says whether the twin's polygons may be compared with the robot's pose | a walk to twin coordinates on an unregistered frame walks to the wrong spot |

## Decisions

### Q1 — Route or refuse

**Chosen:** on a sidecar-backed robot (MuJoCo `sim_g1_dds` or a real G1 — whenever
the pose comes from the hardware sidecar), `move` goes through the same path Agent
Mode's `goto` uses: the navigator + block executor over `LocoClient`, with the place
resolution and the keepout/geofence checks. The command reports `completed` only
when the walk has actually finished, `failed` with the walk's reason otherwise. On a
frame that is not registered to the twin, `move` refuses with a clear error instead
of pretending. The kinematic `SimulationEngine` path stays for pure-sim robots.
**Rejected:** refusing `move` on every sidecar-backed robot — Agent Mode already
proves the walk path works, so a refusal would throw away a working capability.
**Owner:** lead (fixed decision).

### Q2 — How the caller learns the walk finished

**Chosen:** the REST command returns at once with status `executing`; the same
command object in the history flips to `completed`/`failed` when the walk ends.
`roboctl move` polls the history until the command is terminal, so the operator
still gets one final answer.
**Rejected:** holding the HTTP request open for the whole walk — the server forwards
commands through an HTTP client with a timeout, and a walk takes tens of seconds.
**Owner:** implementing agent.

### Q3 — Coordinates, not a place

**Chosen:** a coordinate move walks to a synthetic square place around the point
(the navigator only knows entities and places), so it gets the same planner, keepout
check and arrival rule. Arrival tolerance is therefore the place rule (≤ 1 m from the
centre), not the kinematic 0.1 m.
**Rejected:** a new point-goal mode in the navigator — more code for the same walk.
**Owner:** implementing agent.

### Q4 — What gates a move walk

**Chosen:** a move walk needs a place graph whose frame is registered (no graph at
all is refused too — twin coordinates mean nothing without one), no latched E-Stop,
no running Agent Mode plan, and the control lock (teleop/VLA refuse it). It does NOT
need Agent Mode to be switched on: `move` is an explicit operator command, not
autonomy. `stop` aborts a running move walk.
**Owner:** implementing agent.

### Q5 — Which robots count as sidecar-backed

**Chosen:** a robot is sidecar-backed once the sidecar has answered `/health` with an
odometry frame or has delivered a base pose in this process — and it stays so for
the rest of the process, so a sidecar that drops out makes the walk fail honestly
instead of silently falling back to the kinematic pretence.
**Owner:** implementing agent.

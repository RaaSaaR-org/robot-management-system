# G1 EDU 4 Lab-Bringup — Status & Log

> **Platzhalter in diesem Dokument:** `GPU_BOX` = die GPU-Workstation im Lab · `$UNITREE_ROOT` = Wurzel der Unitree-Checkouts und Spike-Daten · `$CONDA_ENVS` = Conda-Env-Verzeichnis. Konkrete Hostnamen, Benutzer und absolute Pfade stehen bewusst nicht im Repo. In PowerShell-Blöcken stehen sie als `$env:UNITREE_ROOT` usw. — vor dem Kopieren als Umgebungsvariablen setzen.

**Stand: 2026-07-03 (Feierabend — Roboter-Akku leer, alle Dienste gestoppt)**
**Box:** GPU_BOX (Windows, NVIDIA-GPU) · **Roboter:** Unitree G1 EDU 4, PC2 = `192.168.123.164` · **Task:** `.mc/tasks/todo/TASK-169`

> **Sicherheits-Direktive (Owner, in Kraft):** Stufe 1 = Daten vom Roboter **nur lesen**.
> Auf keinen Fall schreiben. Technisch erzwungen, nicht nur beabsichtigt (Details unten).

---

> **Recording with two people** (one in the Quest, one at a desktop): see
> [Two-person data collection](data-collection-two-person.md) for the roles,
> the setup order, who presses what, and what each warning means.

## Start the robot side from NeoDEM (TASK-403)

*Added 2026-10-17. The terminal commands further down still work and stay the
fallback; this section replaces copying them by hand.*

The **robot supervisor** (`robot-agent/supervisor/`) is a small standalone
process on the robot PC. It starts, stops and reports the three robot-side
processes in a fixed order, each behind a readiness gate:

| Step | What it checks or starts | Ready when |
| --- | --- | --- |
| `preflight` | Parses the profile; checks ports 6001 / 8767 / 41245; in arm_sdk mode refuses while `xr_teleoperate` or `teleop_hand_and_arm` runs | ports free or held by its own children |
| `link` | `enp131s0` carrier + operstate up, `192.168.123.222` present, one ping to the robot. A carrier loss is waited out for up to `timeouts.carrierS` (15 s) and the step says how long it waited (TASK-423) | "Robot cable unplugged or robot off … Waited 15 s" when it stays down |
| `camera` | TCP connect to the PC2 head camera `192.168.123.164:5600`, and to each wrist camera the profile names under `wristCameras` (checks `leftWrist` / `rightWrist`) | a **warning** only, never a stop; a wrist that does not answer means takes in a Head + wrists session will not start |
| `bridge` | `g1_state_bridge_readonly.py --iface enp131s0 --domain 0` | `bridge_probe.py` sees `rt/lowstate` on :6001 |
| `sidecar` | `g1_sidecar.py`, **read_only by default** | `/health`: `connected`, the expected `write_mode` and `loco.gate`, `dds_domain` (when reported), fresh `base.age_s` under fsm |
| `agent` | `tsx src/index.ts` with `.env.g1-edu` on **:41245** (not `tsx watch`) | `/api/v1/health` says `healthy` |

After every step it reads the sidecar's `/health` and aborts if `armed` is true,
`arm_weight` is not 0, or the robot's mode changed during the step. A failure
stops the sequence with a plain sentence in the step's `detail`; earlier steps
keep running. Registering the agent with the server is the server's job
(TASK-409) — the supervisor knows no server.

**What it never does:** kill a process it did not start (a stray bridge or agent
on a port shows as `foreign` with its pid, command line, start time and working
directory — *adopt* it to use it as is, or *leave* it and stop it yourself; one
that runs older code than this checkout cannot be adopted, see *Old robot code*
below); SIGKILL a sidecar (SIGTERM ramps the
arms down; a sidecar still alive after 15 s is reported as `sidecar_hung` with
the runbook); set `G1_READ_ONLY` or `G1_ARM_ALLOW_UNKNOWN_FSM` (the profile
loader refuses both); restart a sidecar by itself; command motion or change the
robot's mode. Stop leaves the FSM alone — use the agent's Limp first if the
robot should go limp.

### Install (once, no sudo)

The install has two halves: the supervisor on the robot PC, and the lab's NeoDEM
server pointed at it. Without the second half the readiness panel has no Start
button.

**1. The supervisor** (a user unit, enabled so it comes back after a reboot):

```bash
mkdir -p ~/.config/systemd/user ~/.config/neodem
ln -sf ~/develop/robot-management-system/robot-agent/supervisor/systemd/neodem-robot-supervisor@.service \
       ~/.config/systemd/user/
printf 'ROBOT_SUPERVISOR_TOKEN=%s\n' "$(openssl rand -hex 24)" > ~/.config/neodem/supervisor-g1-edu-4.env
chmod 600 ~/.config/neodem/supervisor-g1-edu-4.env
systemctl --user daemon-reload
systemctl --user enable --now neodem-robot-supervisor@g1-edu-4
curl -s 127.0.0.1:8766/healthz                 # the check: {"ok":true,...}
```

**2. The server half.** Append the supervisor and the same token to the lab
server's `server/.env`, then restart the server — editing `.env` does not
restart `tsx watch`:

```bash
cd ~/develop/robot-management-system
. ~/.config/neodem/supervisor-g1-edu-4.env
printf '\nROBOT_SUPERVISORS=g1-edu-4=http://127.0.0.1:8766\nROBOT_SUPERVISOR_TOKEN=%s\n' \
  "$ROBOT_SUPERVISOR_TOKEN" >> server/.env
# then stop the server (Ctrl-C in its terminal) and run `npm run dev` in server/ again
```

Open the robot's **Teleop** tab: the readiness panel now reads "Robot side is
stopped. Press Start." with a **Start robot side** button. Only the lab's NeoDEM
server points at the real robot's supervisor; branch servers and test stacks
never do.

**After a code update** (a pull, a merge, a branch switch): press **Stop robot
side**, then **Start robot side**. The supervisor compares each process's start
time with the code it runs; one started before its code shows as *runs code from
before …* and the panel reads "The robot agent runs older code than NeoDEM.
Restart the robot side." until you do.

- **Profile:** `robot-agent/hardware/profiles/g1-edu-4.yaml` (checked in, no
  secrets). The unit takes `%i` as the robot id and reads `profiles/%i.yaml`.
- **Token:** every route except `GET /healthz` needs
  `Authorization: Bearer $ROBOT_SUPERVISOR_TOKEN`. The server proxy (TASK-409)
  gets the same token (`ROBOT_SUPERVISOR_TOKEN` in `server/.env`, step 2 above).
- **Port:** 127.0.0.1:8766, one supervisor per robot (lock file
  `~/.local/state/neodem/g1-edu-4/supervisor.lock`).
- **State:** PID files in `~/.local/state/neodem/g1-edu-4/`, logs in
  `~/.local/state/neodem/logs/g1-edu-4-<proc>.log`.
- The unit uses `KillMode=process`: `systemctl --user restart` restarts only the
  supervisor; the children keep running and are re-adopted from their PID
  files. **Stopping the robot side is `POST /stop`, not `systemctl stop`.**
- The agent runs from `robot-agent/` and needs `npm ci` there (the supervisor
  has no `node_modules` of its own; it resolves from `robot-agent/node_modules`).

### Old robot code (TASK-419)

For every running bridge, sidecar and agent the supervisor compares the process's
start time (`/proc/<pid>/stat`) with the newest change of the code it runs —
`robot-agent/src` + `robot-agent/package-lock.json` for the agent, the script
file for the bridge and the sidecar: the last commit touching them
(`git log -1 --format=%ct`) and the files' modification times (a pull, a checkout
or an edit rewrites them). Git answers are cached for 30 s.

- **A process the supervisor started** that is older than its code gets
  `checks.staleCode = {startedAt, codeAt}` and a warning: "runs code from before
  <date> — restart the robot side". Stop and Start in the panel fixes it.
- **The supervisor itself is not covered.** Stop and Start restart only its
  children, and the stale-code check looks only at them. After a change under
  `robot-agent/supervisor/` (a pull that touches it, e.g. TASK-423's carrier
  wait), restart the supervisor:
  `systemctl --user restart neodem-robot-supervisor@<robot>` (e.g.
  `@g1-edu-4`). The children keep running and are re-adopted.
- **A foreign process** carries the same verdict in `foreign.staleCode`, plus its
  `cwd` and the robot id its environment names. A process that runs from another
  checkout (an old worktree) is compared by that checkout's own commit time. A
  stale foreign process **cannot be adopted** (409 `stale_code`); the panel shows
  "Runs code from before <date>. Stop it, then press Start." with a copyable
  `kill -TERM <pid>`. The supervisor still never signals it — that one command is
  the only terminal step left.
- The server turns either verdict into the reason `agent_outdated`. An agent that
  answers `/api/v1/health` but has no readiness route (code from before TASK-405)
  reads the same way.

### Use it

```bash
. ~/.config/neodem/supervisor-g1-edu-4.env
S=http://127.0.0.1:8766; A="Authorization: Bearer $ROBOT_SUPERVISOR_TOKEN"
curl -s -XPOST -H "$A" $S/start                 # read_only; 202, then poll:
curl -s -H "$A" $S/status | jq '.overall, (.steps[] | {id, state, detail})'
curl -s -XPOST -H "$A" $S/lan/up                # nmcli con up g1-robot-lan — only when you call it
curl -s -H "$A" "$S/logs/sidecar?tail=50"       # also /logs/<proc>/stream (SSE)
curl -s -XPOST -H "$A" $S/stop                  # disarm -> agent -> sidecar -> bridge
curl -s -XPOST -H "$A" $S/estop                 # last resort: forwards to the sidecar's /estop
```

`overall` is `stopped`, `starting`, `ready`, `degraded` (a child died after it was
ready), `stopping` or `error` (a step failed, or `sidecar_hung`). The bridge may
restart up to 3 times with backoff and the agent once; a sidecar never restarts
by itself.

**arm_sdk** is a separate, confirmed switch — never part of a start:

```bash
curl -s -XPOST -H "$A" $S/sidecar/mode -d '{"mode":"arm_sdk","confirm":true}'
```

It refuses while the arms are armed or `xr_teleoperate` runs, SIGTERMs the
read-only sidecar (up to 15 s), and starts the arm_sdk block of the profile
(`G1_WRITE_MODE=arm_sdk`, `G1_LOCO_ENABLED=fsm`, `G1_ARM_SDK_MAX_JOINT_VEL=1.0`,
`G1_DDS_DOMAIN=0`), which must come up with `armed:false, arm_weight:0`. The
control-lease check is the server's (TASK-409). Everything in "Arm teleop
through arm_sdk" and "Mode changes without the remote" below still applies.

**A stale process on a port** (e.g. a bridge started by hand days ago on an
interface with no carrier): `/status` shows the step as `foreign` with
`foreign.pid`, `foreign.cmdline` and `foreign.since`. `POST /steps/bridge/adopt`
uses it as is (and never signals it); `POST /steps/bridge/leave` keeps it
untouched and the start stays blocked until you stop it yourself.

### Rehearsal against the MuJoCo DDS sim

`robot-agent/hardware/profiles/sim-g1-edu-dev.yaml` runs the same chain against
`sim_g1_dds` on DDS domain 42 / `lo`, on its own ports (sim 18782, bridge 16001,
sidecar 18777, agent 41299), so it leaves the dev stack on :8777/:41246 alone:

```bash
cd robot-agent/supervisor
ROBOT_SUPERVISOR_TOKEN=$(openssl rand -hex 24) ROBOT_SUPERVISOR_PORT=18766 \
  node --import tsx src/index.ts ../hardware/profiles/sim-g1-edu-dev.yaml
```

Here the `link` step starts the simulator instead of checking a cable. Verified
2026-10-17 on a copy of this profile (domain 53): start → `ready`,
read_only → arm_sdk switch (`armed:false`, sim stays limp), supervisor restart
re-adopts all four children, stop leaves nothing running.

**The sim robot in the app (TASK-420).** To rehearse a whole data-collection
session from the readiness panel, run the sim profile as a second instance of
the same user unit. Its robot id is `sim-g1-edu-dev`, it listens on
127.0.0.1:**18766**, and like the real robot it starts read_only, with the sim
in damp (`--initial-fsm 1`). The server holds **one** `ROBOT_SUPERVISOR_TOKEN`
for every supervisor, so the sim's env file reuses the token from step 1 of the
install above:

```bash
E=~/.config/neodem/supervisor-sim-g1-edu-dev.env
{ grep '^ROBOT_SUPERVISOR_TOKEN=' ~/.config/neodem/supervisor-g1-edu-4.env
  echo 'ROBOT_SUPERVISOR_PORT=18766'; } > "$E"
chmod 600 "$E"
systemctl --user daemon-reload
systemctl --user enable --now neodem-robot-supervisor@sim-g1-edu-dev
curl -s 127.0.0.1:18766/healthz                # {"ok":true,...}
```

On a machine without the real robot's supervisor, write a new token instead
(`printf 'ROBOT_SUPERVISOR_TOKEN=%s\n' "$(openssl rand -hex 24)"`), and put that
same token in `server/.env`. Then list both supervisors in the server's
`server/.env` and restart the server:

```bash
ROBOT_SUPERVISORS=g1-edu-4=http://127.0.0.1:8766,sim-g1-edu-dev=http://127.0.0.1:18766
ROBOT_SUPERVISOR_TOKEN=<the same token as in the env files>
```

Never print the token or commit it. The profile's agent reads
`robot-agent/.env.g1-edu-sim` (copy it from `.env.g1-edu-sim.example` once);
the profile itself sets its port, robot id and sidecar URL. The agent does not
register itself (its `SERVER_URL` points at a dead port): the server registers
it once a Start through the server reaches the agent step. If the robot does not
appear in the app yet, start it once through the API, then use the panel:

```bash
curl -s -XPOST -H 'Content-Type: application/json' \
  localhost:3001/api/robots/sim-g1-edu-dev/bringup/start -d '{"mode":"read_only"}'
```

(This works as is with `AUTH_DISABLED=true`; with auth on, add a member's bearer
token.) From then on the session runbook,
[Two-person data collection](data-collection-two-person.md), works the same
for `sim-g1-edu-dev` as for `g1-edu-4`.

---

## Was heute erreicht wurde

**End-to-end verifiziert: Der reale G1 EDU 4 liefert Live-Telemetrie bis in den 3D-Viewer der App — komplett read-only, mit null Software-Footprint auf dem Roboter.**

Kette: `Roboter (DDS rt/lowstate, Domain 0)` → `g1_state_bridge_readonly.py` (Workstation, ~50 Hz) → `ZMQ :6001` → `g1_sidecar.py :8767 (G1_READ_ONLY)` → `robot-agent g1-edu-4 :41245` → `Server :3001` → `App :1420 (3D-Viewer)`

### 1. RMS auf nativem Windows lauffähig gemacht

- Drei `new URL(import.meta.url).pathname`-Bugs (→ `C:\C:\...`-Pfade) per `fileURLToPath()` gefixt: `robot-agent/src/index.ts`, `robot/StatePersistence.ts`, `robot/state.ts`. Cross-platform korrekt, upstream-würdig.
- `NODE_ENV=development` in `server/.env` (sonst wirft die Compliance-Verschlüsselung im Produktionspfad 500er).

### 2. Sicherheitsanalyse: Stock-Bridge ist für read-only unbrauchbar

Die lerobot-Bridge (`run_g1_server.py`) loopt beim Start `MotionSwitcherClient.ReleaseMode()` — **ein stehender Roboter verliert seinen Balance-Controller und fällt** — und öffnet einen lowcmd-Kommandopfad. `UnitreeG1.connect()` legt ebenfalls einen `rt/lowcmd`-Publisher an. Deshalb Eigenbau:

### 3. Read-only-Architektur gebaut und verifiziert

- **`robot-agent/hardware/g1_state_bridge_readonly.py`** (neu): Subscribed nur `rt/lowstate`, republished als ZMQ PUB :6001 im run_g1_server-Wire-Format. Kein MotionSwitcher, kein Publisher, kein Kommando-Socket — dieser Prozess *kann* konstruktiv keinen einzigen DDS-Befehl senden.
- **`g1_sidecar.py`**: `G1_READ_ONLY`-Modus (**Default AN**) — `POST /action` und `POST /record/start` → HTTP 403 (verifiziert), der lerobot-Treiber wird nie geladen, State kommt per ZMQ-SUB.
- **`robot-agent/.env.g1-edu`** (neu): Agent-Profil `g1-edu-4` (ROBOT_TYPE=g1_edu, Port 41245).

### 4. Architektur-Pivot: DDS direkt von der Workstation (statt Bridge auf PC2)

SSH-Recon auf PC2 (Creds vom Owner) ergab: Jetson, Ubuntu 20.04, Python 3.8, Image `g1plus_pc4` — **kein `unitree_sdk2py`, kein pyzmq, kein Internet**; cyclonedds 0.10.2 hat keine aarch64-Wheels → Offline-Install unpraktikabel. Lösung: Die Workstation hängt mit `192.168.123.10` (Adapter „Ethernet") direkt im Roboter-Segment und tritt **DDS-Domain 0 selbst bei**. Die Bridge läuft lokal — auf PC2 wurde **nichts installiert und nichts verändert**.

Setup dafür (bleibt bestehen):
- venv `$UNITREE_ROOT/.venv-g1-dds` (Python 3.10 via uv — cyclonedds 0.10.2 hat nur Wheels bis cp310) mit `cyclonedds==0.10.2` (Win-Wheel), `pyzmq`, `numpy`
- `$UNITREE_ROOT/unitree_sdk2_python` (Klon @ Pin `4f12b01`) — **nicht installiert**, nur via `PYTHONPATH` (pure Python)

### 5. Verifikationen (alle bestanden)

| Check | Ergebnis |
|---|---|
| DDS-Empfang | 35 Motor-Slots, ~50 Hz, plausible Werte |
| Sidecar `/health` | `{"status":"ok","connected":true,"read_only":true}` |
| Sidecar `/state` | 29 Körpergelenke, Namen exakt ≡ `g1.config.ts`/`g1_edu.yaml` |
| Schreib-Guards | `POST /action`, `POST /record/start` → 403 |
| Server-Telemetrie | `GET /api/robots/g1-edu-4/telemetry` → 29 jointStates, echte Werte |
| 3D-Viewer (Playwright) | Echte Pose sichtbar (gebeugte Knie ~0.3 rad, Ellbogen ~1.45 rad) |
| Liveness | Telemetrie-Diff über 5 s: 17/29 Gelenke drifteten auf Sensor-Rausch-Niveau — Feed ist live, nicht gecacht |

Die 14 Dex3-Hand-Gelenke fehlen in Stufe 1 **bewusst**: `rt/lowstate` enthält keine Hand-Daten (separate DDS-Topics), und wir fabrizieren nichts — Telemetrie meldet daher 29 statt 43 jointStates.

### 6. Frontend-Bugfix: 3D-Viewer kannte `g1_edu` nicht

Der `RobotType`-Union der App fehlte `g1_edu` → Viewer fiel auf eine generische Box zurück. Fix: `normalizeRobotType()` in `app/src/features/robots/types/robots.types.ts` (mappt `g1_edu`→`g1`, lowercased, Unbekanntes→`generic`), eingesetzt in `OverviewTab`, `Model3DTab` und zentral in `Robot3DViewer`/`RobotModel` (deckt auch `SessionDetailPage`, `RobotHeroSection`, `VRTeleopSection` ab). Playwright-verifiziert. Nebenbefund: `Model3DTab` ist nirgends gemountet (toter Code); der Overview-Tab „Live Model" ist der einzige erreichbare Viewer.

### 7. Offizielle Unitree-Modelle abgelegt

`temp/unitree_model/` (gitignorierter Klon) enthält Unitrees offizielle **USD-Modelle** (G1 29dof rev_1_0, H1, H2, H2_Plus, Go2, B2) — für Isaac Sim (Stage 3+). Der Web-Viewer braucht sie nicht: Die App bündelt dasselbe Modell bereits als URDF+STL unter `app/public/assets/robots/g1/`.

---

## Aktueller Zustand

- **Alle Dev-Prozesse gestoppt** (Roboter-Akku leer): Bridge, Sidecar, Server, SimBot-Agent, G1-Agent, App. Alle Ports (3001, 41243, 41245, 1420, 8767, 6001) frei.
- **TASK-169:** Stage 0 ✓ (bis auf lerobot/SDK2-Install — erst ab Stage 2 nötig). Stage 1: alle Software-Gates ✓; **einziges offenes Gate: physischer E-Stop-Test**. Stages 2–4 nicht begonnen.
- **Uncommitted** (bewusst, Owner-Entscheid ausstehend): fileURLToPath-Fixes (3 Dateien), Sidecar-Read-only-Umbau + neue Bridge, App-Viewer-Fix (5 Dateien), TASK-169-Updates, `package-lock.json`. Vorschlag: 2–3 Commits (`fix(robot-agent): windows-safe paths`, `feat(robot-agent): read-only G1 telemetry path`, `fix(app): map g1_edu to g1 model in 3D viewer`).

## Neustart-Anleitung (nächste Session, Reihenfolge)

*Fallback by hand — the supervisor above does this for you ("Start the robot side from NeoDEM").*

```powershell
# 1. DDS→ZMQ-Bridge (read-only), im Repo-Root robot-management-system:
$env:PYTHONPATH="$env:UNITREE_ROOT/unitree_sdk2_python"; $env:PYTHONIOENCODING="utf-8"
& "$env:UNITREE_ROOT/.venv-g1-dds/Scripts/python.exe" robot-agent\hardware\g1_state_bridge_readonly.py --iface Ethernet

# 2. Sidecar (read-only, Default):
$env:G1_LOWSTATE_ENDPOINT="tcp://127.0.0.1:6001"; $env:PYTHONIOENCODING="utf-8"
& "$env:UNITREE_ROOT/.venv-g1-sidecar/Scripts/python.exe" robot-agent\hardware\g1_sidecar.py

# 3. Server:            cd server && npm run dev
# 4. G1-Agent (Git-Bash! POSIX-Env-Syntax):
#    cd robot-agent && DOTENV_CONFIG_PATH=.env.g1-edu npx tsx watch src/index.ts
# 5. App:               cd app && npm run dev
# 6. Agent registrieren (falls nicht mehr in DB):
#    POST http://localhost:3001/api/robots/register {"robotUrl":"http://localhost:41245"}
```

SSH PC2: `unitree@192.168.123.164` (Passwort beim Owner). Windows-Falle: Prozess-Stop killt u. U. nur den npm-Wrapper — verwaiste node-PIDs via `Get-NetTCPConnection -LocalPort <port>` finden und `taskkill /PID <pid> /F`.

## Nächste TODOs

1. **E-Stop-Test (physisch)** — letztes Stage-1-Gate: E-Stop erreichbar + getestet, *bevor* je Motion ansteht.
2. **Commits** — Owner entscheidet über die drei Commit-Pakete oben.
3. **Stage 2 (Teleop-Recording, erste Bewegung — durch Unitree balanciert, nicht durch uns):**
   - lerobot + unitree_sdk2py mit `unitree_g1`-Klassen installieren (Stage-0-Restpunkt).
   - Native Unitree-Teleop via `lerobot-record`; kleines LeRobot-v2.1-Dataset aufnehmen; Import/Playback/Kuration im RMS prüfen.
   - Erst hier braucht es einen Kommandopfad — **nur nach expliziter Owner-Freigabe** (`G1_READ_ONLY=0` + E-Stop besetzt).
   - *Superseded 2026-10-17 (TASK-391):* the `G1_READ_ONLY=0` / lerobot `rt/lowcmd` path is removed. The command path is now `G1_WRITE_MODE=arm_sdk` — see "Arm teleop through arm_sdk" below.
4. **Optional Stufe 1.5:** Dex3-Hand-Telemetrie ergänzen (separate DDS-Topics `rt/dex3/left|right/state` subscriben) → 43 echte jointStates.
5. **Stage 3 (off-robot):** G1 in die MuJoCo-Sim-Eval-Pipeline; USD-Modelle aus `temp/unitree_model` für Isaac-Sim-Arbeiten (WSL2).
6. **Aufräumen (nice-to-have):** `Model3DTab` toter Code — entfernen oder als Tab mounten.

---

## Arm teleop through arm_sdk (TASK-391)

*Written 2026-10-17 for the first NeoDEM-driven teleop session on the real G1.
The commands below have been run against the MuJoCo DDS sim only — not yet
against the robot.*

### What the sidecar does now

`robot-agent/hardware/g1_sidecar.py` has two write modes, chosen at start:

| `G1_WRITE_MODE` | What exists in the process |
| --- | --- |
| unset / `read_only` (default) | Telemetry only. No joint-command publisher. `/action`, `/arm`, `/record/start` → 403. Unchanged from stage 1. |
| `arm_sdk` | `rt/arm_sdk` (`unitree_hg LowCmd_`) + `rt/dex3/{left,right}/cmd` (`HandCmd_`) publishers — silent until `POST /arm`. |

`rt/arm_sdk` is Unitree's arm-only channel: it is blended into the running
balance controller through a weight in `motor_cmd[29].q`. The legs stay under
Unitree's control whatever the weight is. This replaces the old
`G1_READ_ONLY=0` path, which loaded lerobot's driver and wrote `rt/lowcmd`
(debug mode, no balance — a standing robot falls). `G1_READ_ONLY=0` without
`G1_WRITE_MODE=arm_sdk` now refuses to start, and `/record/start` is refused in
both modes (it spawned `lerobot-record`, i.e. the same `rt/lowcmd` driver).

| Route | Behaviour |
| --- | --- |
| `POST /arm {"lease_generation": n}` | Seeds every target from the **measured** pose, weight 0→1 over 1.5 s; the reply carries that pose as `seed` (`{joint: rad}`), which the agent starts its teleop targets from. 409 `estop_latched`, 503 `no_state` (no fresh `rt/lowstate`). |
| `POST /action {"<joint>": rad}` | Only while armed (else 409 `not_armed`). Clamped to the joint limits minus 0.05 rad, slewed at ≤ 3 rad/s (arms) / 6 rad/s (fingers). Leg and waist keys are ignored and counted. |
| `POST /disarm` | Weight 1→0 over 1 s, five explicit weight-0 frames, then silence. |
| `POST /estop` | The same ramp, plus a latch: `/arm` → 409 until `POST /estop/reset`. |
| dead-man | No `/action` for 0.5 s → hold; 1.0 s → disarm (`last_disarm_reason: "deadman"`). The agent must keep `/action` flowing (≥ 20 Hz) while engaged, even when the pose does not change. |
| SIGTERM / SIGINT | Disarm ramp starts at the signal; the process exits after weight 0 (~1.2 s). |
| `GET /health`, `/state` | `write_mode`, `armed`, `arm_state`, `arm_weight`, `estop_latched`, `hands {left,right}`, `teleop_mode`, `dds_domain`, `dds_iface`. |

In arm_sdk mode the HTTP API listens on **127.0.0.1 only** (read_only keeps
`0.0.0.0`): the routes are unauthenticated and `/arm` + `/action` move the arms,
so they must not be reachable from the lab Wi-Fi or the robot LAN. The agent
reaches it at `http://localhost:8767` as before. `G1_SIDECAR_HOST` overrides
the address, and the sidecar warns at start when it is not loopback.

What one `rt/arm_sdk` frame carries: the 14 arm joints (the only operator
targets, kp 80/kd 3 shoulders+elbows, kp 40/kd 1.5 wrists); the waist **held at
the pose measured at `/arm`** (kp 300/kd 3, xr_teleoperate's motion-mode lock —
the waist is part of the arm_sdk blend, so kp 0 would hand the blend a limp
waist); the legs at their measured pose with kp = kd = 0 (ignored by the
robot's blender). Dex3 commands go out only for a hand whose state arrived in
the last 0.5 s: with the right hand silent (as on 2026-10-16) `/arm` still
succeeds and reports `teleop_mode: "arms+left_hand"` instead of blocking.

### Before you start

- The robot must be in its **normal (motion) mode, not debug mode**: arm_sdk
  blends into the balance controller, so that controller must be running.
  xr_teleoperate leaves the robot in debug mode on exit — switch back with the
  remote or reboot.
- **The robot must be in balance** (Regular Mode, the remote's R1+X: FSM 501 on
  g1-edu-4, which has the 3-DoF waist; 500 on a 1-DoF-waist G1) before `/arm`
  — since TASK-398 the sidecar refuses `/arm` otherwise (`not_in_balance`,
  `fsm_unknown`). With no remote on site, NeoDEM puts it there: see
  ["Mode changes without the remote"](#mode-changes-without-the-remote-task-398)
  below, which replaces the remote steps (L2+Up, R1+X) of this list.
- Gantry attached for the first session. One person at the robot (gantry hoist
  and battery button); the NeoDEM E-stop (app STOP, VR B/Y, or
  `curl -XPOST localhost:8767/estop`) disarms the arms and damps the robot.
- The read-only bridge keeps running (`g1_state_bridge_readonly.py --iface
  enp131s0 --domain 0`, ZMQ :6001): `/state` reads BMS and odometry from it.
- Stop the read-only sidecar on :8767 first — the arm_sdk sidecar takes the
  same port, so the g1-edu-4 agent needs no change.
- Do not reuse the stage-1 environment as is: it sets `G1_READ_ONLY=1`, and
  `G1_READ_ONLY=1` + `G1_WRITE_MODE=arm_sdk` refuses to start on purpose.

### Start (robot day — written, not run)

```bash
cd ~/develop/robot-management-system/robot-agent/hardware
export CYCLONEDDS_HOME=/home/humanoid/Dokumente/Unitree/g1_quest_teleop/third_party/checkouts/cyclonedds/install
env G1_WRITE_MODE=arm_sdk \
    G1_DDS_DOMAIN=0 G1_DDS_IFACE=enp131s0 G1_NET_INTERFACE=enp131s0 \
    G1_LOWSTATE_ENDPOINT=tcp://127.0.0.1:6001 \
    G1_CAMERA_SOURCE=pc2cam G1_PC2_CAMERA_HOST=192.168.123.164 G1_PC2_CAMERA_PORT=5600 \
    G1_ALLOW_LIDAR_SWITCH=0 G1_LOCO_ENABLED=0 \
    G1_ROBOT_ID=g1-edu-4 G1_ROBOT_IP=192.168.123.164 \
    G1_ARM_SDK_MAX_JOINT_VEL=1.0 \
    ~/anaconda3/envs/unitree_sim_env6/bin/python -u g1_sidecar.py
```

With wrist cameras, add
`G1_WRIST_CAMERAS=left_wrist_camera@<publisher host>:5601,right_wrist_camera@<publisher host>:5602`
(left first, ports as in "Wrist cameras (TASK-444)"; the supervisor composes the same value from the profile's `wristCameras`).
Leave it unset for a head-camera-only robot.

`G1_ARM_SDK_MAX_JOINT_VEL=1.0` is a deliberately slow first session; the
default is 3.0 rad/s. Raise it once the arms have been seen to follow.

Smoke test, in this order, before the Quest is involved:

```bash
curl -s localhost:8767/health   # write_mode arm_sdk, dds_domain 0, armed false, hands, teleop_mode
# 1. arm with NO /action: the arms ramp in, hold where they are, and the dead-man
#    hands them back after 1 s. Nothing should visibly move.
curl -s -XPOST localhost:8767/arm -d '{"lease_generation": null}'
sleep 3; curl -s localhost:8767/health   # arm_state disarmed, last_disarm_reason deadman
# 2. e-stop latch
curl -s -XPOST localhost:8767/estop; curl -s -XPOST localhost:8767/arm   # -> 409 estop_latched
curl -s -XPOST localhost:8767/estop/reset
```

Then teleop through the app (the agent arms under its control lease and streams
`/action`).

### Rehearsal against the MuJoCo DDS sim

Domain 41 on loopback: domain 1 is where the dev stack's own sim lives, and two
sims on one domain would read each other's state.

```bash
cd robot-agent/hardware/sim_g1_dds
export CYCLONEDDS_HOME=/home/humanoid/Dokumente/Unitree/g1_quest_teleop/third_party/checkouts/cyclonedds/install
MUJOCO_GL=egl PYOPENGL_PLATFORM=egl LIBGL_ALWAYS_SOFTWARE=1 CUDA_VISIBLE_DEVICES= \
  ~/anaconda3/envs/unitree_sim_env6/bin/python sim_node.py --domain 41 --iface lo --http-port 8781 &
(cd .. && G1_WRITE_MODE=arm_sdk G1_DDS_DOMAIN=41 G1_DDS_IFACE=lo G1_SIDECAR_PORT=8791 \
  G1_LOWSTATE_ENDPOINT=tcp://127.0.0.1:1 G1_ALLOW_LIDAR_SWITCH=0 \
  ~/anaconda3/envs/unitree_sim_env6/bin/python -u g1_sidecar.py &)
~/anaconda3/envs/unitree_sim_env6/bin/python arm_sdk_sim_check.py --domain 41 --iface lo \
  --sim http://127.0.0.1:8781 --sidecar http://127.0.0.1:8791 --sidecar-pid <sidecar pid>
```

`arm_sdk_sim_check.py` refuses domain 0, any non-loopback interface, and a
sidecar whose `/health` reports another domain.

### Not yet verified on the robot

- FSM id 4 as the G1's lock stand (L2+Up). Unitree's C++ `g1_loco_client.hpp`
  maps `StandUp()` to `SetFsmId(4)`; `/health.loco.ids_verified` stays `false`
  until runbook step 4 below has been run and recorded in TASK-398.
- What `GetFsmMode` (`base.fsm_mode`) and `rt/odommodestate.mode`
  (`base.odom_mode`) report in each mode — both are logged, nothing gates on
  them yet.
- The drift guard default `G1_ARM_TRACK_ERR_RAD=0.35` (0.3 s): read
  `track_err_rad` from `/health` during the first session and tune it.
- That the robot's arm_sdk blender ignores the leg slots (Unitree's examples
  and xr_teleoperate's motion mode say so; the sim blends all 29).
- The waist hold at kp 300 / kd 3 while the balance controller is running.
- `mode_machine` taken from `rt/lowstate`, as bridge.py and xr_teleoperate do.
- The Dex3 RIS mode byte and kp 1.5 / kd 0.2 (from xr_teleoperate's
  Dex3_1_Controller), and whether the right hand publishes state at all.
- What the robot does when `rt/arm_sdk` goes silent at a weight above 0. Every
  exit the sidecar controls (disarm, e-stop, dead-man, stale state, publish
  error, SIGTERM/SIGINT) ramps to 0 first, but a `kill -9`, an OOM kill or a
  power loss of this box cannot. Keep the hardware e-stop / remote staffed, and
  stop the sidecar with SIGTERM or Ctrl-C, never `kill -9`.
- Dex3 commands have no blend weight: after a disarm each hand keeps its last
  commanded position at kp 1.5 until something else commands it.

---

## Mode changes without the remote (TASK-398)

*Written 2026-10-17. Run against the MuJoCo DDS sim
(`sim_g1_dds/loco_mode_sim_check.py`, domain 42), not yet against the robot.
It amends "Before you start" above, which assumed the Unitree remote.*

There is no remote on site. The sidecar changes the robot's mode instead —
**mode changes only**: walking, turning, gestures and raw FSM ids stay
impossible.

### What the sidecar does

`G1_LOCO_ENABLED` takes three values:

| Value | Meaning |
| --- | --- |
| `0` / unset | No mode control, no locomotion. `/loco/*` → 403. |
| `fsm` | **The real robot.** `POST /loco/mode` (limp / stand / balance) and the E-stop's damp. The only RPCs that can leave the process are `SetFsmId(1 \| 4 \| balance id)`, `GetFsmId` and `GetFsmMode`. `/loco/move`, `/loco/action` (incl. stop), `/loco/stand-height` and `/loco/fsm` → 403. |
| `1` | Full locomotion (the sim / Agent Mode). |

Anything else refuses to start, and so does `fsm`/`1` without an explicit
`G1_DDS_DOMAIN`. With the gate on the HTTP API listens on 127.0.0.1 even in
read-only mode.

An FSM monitor polls `GetFsmId` at 2 Hz; `/health` and `/state` carry the
**measured** mode as `base: {fsm_id, mode, age_s, fsm_mode, odom_mode, error}`
(`mode` is `unknown` when the reading is older than 1.5 s), and `/health.loco`
says what the gate allows.

| Request | Allowed from (measured) | Also needs |
| --- | --- | --- |
| `limp` (`SetFsmId(1)`) | anything, incl. unknown | nothing — disarms the arms first, never blocked |
| `stand` (`SetFsmId(4)`) | limp | arms disengaged, E-stop not latched |
| `balance` (`SetFsmId(500)`, or `501` with `G1_FSM_ID_BALANCE=501`) | stand, held ≥ 2 s | arms disengaged, E-stop not latched |

**The balance id depends on the waist** (lab test, 2026-10-29). Balance is
Regular Mode, the remote's R1+X: FSM **500** on a G1 with the 1-DoF waist, FSM
**501** on one with the 3-DoF waist (29 DoF). g1-edu-4 has the 3-DoF waist (its
motion switcher reports `{'form':'0','name':'ai'}`): it accepts `SetFsmId(500)`
and ignores it — it stays in FSM 4, so balance never confirms and `/arm` stays
refused. With 501 it confirmed balance in 0.2 s and stood stable. Its profile
(`robot-agent/hardware/profiles/g1-edu-4.yaml`, arm_sdk block) therefore sets
`G1_FSM_ID_BALANCE=501`; `G1_FSM_BALANCE_REPORTED` defaults to the commanded id,
and the sidecar refuses to start when it does not include it. Allowed: 500 and
501. The supervisor reads the profile only at its preflight, so a changed
profile needs a `/stop` and `/start`. A balance that stays unconfirmed while the
robot still reports FSM 4 after `SetFsmId(500)` says so in its error: if this G1
has the 3-DoF waist, it needs 501.

Other FSM ids worth knowing: 0 zero torque, 1 limp (damp), 4 locked stand,
801 running mode.

A robot found in **zero torque** (FSM 0) is not stood up directly: `stand` is
refused with `bad_transition` and `next: "limp"` ("command limp first"), and the
app's mode panel shows the bring-up strip *Zero torque → Limp → Stand → Balance*
with the next button marked. Limp, Stand up and Balance stay three confirmed
clicks — nothing chains them (TASK-423).

Each change is confirmed by `GetFsmId` within 5 s or answers **504
`unconfirmed`** — with no automatic recovery: the UI shows the measured mode and
offers Limp. Refusals carry a `code` (`bad_transition`, `not_settled`,
`arms_engaged`, `estop_latched`, `fsm_unknown`, `mode_change_in_flight`,
`rpc_failed`).

`POST /estop` = latch → disarm ramp starts → **damp** (`SetFsmId(1)`, confirmed
for 2 s). It does not wait out the 1 s arm ramp: in damp the robot ignores
arm_sdk. `POST /estop/reset` clears the latch and **does not stand the robot
up**. SIGTERM of the sidecar does **not** damp (it disarms and leaves zero
frames), so a restart never drops the robot. `POST /estop {"damp": false}`
latches and disarms without damping: the agent sends it for a protective stop
(server link lost, tilt warning, geofence), which must not drop a balancing
robot into the gantry. A Stand up or Balance that was still waiting for the
sport RPC when an E-stop or Limp went out is dropped unsent (409, `sent:false`).

`/arm` now needs a fresh measured balance (FSM in `G1_FSM_BALANCE_REPORTED`,
default: the commanded balance id, 501 on g1-edu-4). While armed, the arms disarm by themselves when the robot leaves
balance (`left_balance`), when the reading is older than 2 s (`fsm_stale`), and
when the measured arm stays more than 0.35 rad from the command for 0.3 s
(`tracking_error`). `G1_ARM_ALLOW_UNKNOWN_FSM=1` disables the mode check for a
session in which a person with the remote has put the robot in balance — the
sidecar warns loudly at start.

In NeoDEM: the **VR window header** (desktop view) and the **VR data-collection
session page** show `Mode: Limp | Stand (locked) | Balance | Unknown`, and the
buttons **Stand up**, **Balance** and **Limp**, each behind a confirmation and
each saying why it is disabled. They need the control lease (with control
leases off on the server they stay disabled and say so). Limp stays clickable
while a Stand up or Balance waits for its confirmation — it interrupts it. The headset shows
the mode only (`ROBOT LIMP — use the desktop window`, `MODE UNKNOWN`) — never a
button. Head turns and thumbsticks send nothing to a robot that does not walk.

### People

- One person at the robot, with the gantry hoist and the battery power button.
- One person at the desktop VR window.
- One operator in the headset.

**Robot state:** normal mode, not debug mode. After power-on it is in damp.
If it reads zero torque (FSM 0) instead, **Limp** first: Stand up from zero
torque is refused (`bad_transition`, observed 2026-10-29). The sequence is
always Limp → Stand up → Balance.

### Sequence

1. **Start the sidecar** with the arm_sdk line above, `G1_LOCO_ENABLED=0`
   replaced by **`G1_LOCO_ENABLED=fsm`**. The start banner names the gate, the
   domain, the interface and the FSM ids, and marks stand id 4 as unverified.
2. **Check `/health`:**
   - `curl -s localhost:8767/health` must show `loco.gate "fsm"`,
     `loco.move_enabled false`, `base.mode "limp"`, `base.fsm_id 1` and
     `base.age_s < 1.5`.
   - If `base.mode` is `"unknown"`, the sport service is not answering (the
     `error` says so) — the robot is probably in debug mode. **Stop here.**
     Power-cycle the robot.
   - `curl -s -XPOST localhost:8767/loco/move -d '{}'` must answer 403.
3. **Feet on the floor.** Lower the gantry until both feet are flat on the
   floor. Leave a hand's width of slack, so a sag is caught within about 10 cm.
   **Do not stand up or balance a robot hanging in the gantry**: the balance
   controller needs the feet on the floor (lab test, 2026-10-29).
4. **Stand up** (VR window header or session page) and confirm.
   - Expect the legs to stiffen within about 1–3 s and the readout to show
     `Stand (locked) · FSM 4`.
   - **This step is the on-robot check of FSM id 4.** Record the reported id
     and what the robot did in the TASK-398 task file.
   - If the readout says unconfirmed, the robot moves unexpectedly, or the id
     reads anything else: **Limp** (or E-stop), hoist the gantry, and stop. Do
     not try 706 (`G1_FSM_ID_STAND=706`, squat-to-stand) without the user
     agreeing at the robot.
5. **Wait at least 2 s** with the robot steady. Then **Balance** and confirm.
   - The readout should show `Balance · FSM 501` on g1-edu-4 (`FSM 500` on a
     1-DoF-waist G1). The robot may shift its weight slightly.
   - If it times out and the robot still reports FSM 4, the balance id is
     likely wrong for this robot — the Robot mode panel shows a hint under the
     error: Limp, and if this G1 has the 3-DoF waist set
     `G1_FSM_ID_BALANCE=501` in the profile, restart the robot side.
   - If the robot reports a different id (such as 801), the confirmation times
     out — fail-closed: Limp, and record it. Only after seeing it on the robot
     may `G1_FSM_BALANCE_REPORTED` list it (for example `501,801`).
6. **Take control** in the VR window. The operator puts on the headset,
   **releases, then squeezes** the grip. The arms ramp in over 1.5 s from the
   measured pose.
7. **Record episodes.** Arms plus the left hand only while the right Dex3
   publishes nothing (`teleop_mode=arms+left_hand`).
8. **Finish:**
   - Release the grip; the arms disarm.
   - Hoist the gantry until it carries the robot — first the gantry, then Limp,
     so the robot never drops into slack.
   - **Limp** and confirm.

### If something goes wrong (no remote on site)

| Situation | Action |
| --- | --- |
| The arm misbehaves | Release the grip (disarm over 1 s), or press B/Y or the app STOP button (disarm, then limp, latched). |
| The robot is unstable in balance | E-stop from the app or B/Y. It goes limp into the gantry. |
| The app, server or agent is down but the sidecar is up | On the box: `curl -s -XPOST localhost:8767/estop`. Expect `damped:true`. |
| The mode reads Unknown while the robot is standing | Do not arm (the sidecar refuses anyway). Try `curl -XPOST localhost:8767/estop`. If `damped` is not true: hoist the gantry until it carries the robot, then power off at the battery. |
| The sidecar is dead or hung | The arms return to Unitree after the zero frames (SIGTERM path; **never kill -9**). **The robot stays in balance.** Restart the sidecar with `fsm` and `curl -XPOST localhost:8767/loco/mode -d '{"mode":"limp"}'`, or use the power button with the gantry carrying the robot. **Rule:** whenever the robot is not limp, the gantry stays attached and able to take its weight. |
| After an E-stop reset | The robot stays limp. Go through Stand up, then Balance again. |

### Rehearsal against the MuJoCo DDS sim

Domain 42 on loopback; the sim starts in damp like a real G1 after power-on.

```bash
cd robot-agent/hardware/sim_g1_dds
export CYCLONEDDS_HOME=/home/humanoid/Dokumente/Unitree/g1_quest_teleop/third_party/checkouts/cyclonedds/install
MUJOCO_GL=egl ~/anaconda3/envs/unitree_sim_env6/bin/python sim_node.py \
  --scene ../sim_evaluator/mjcf/g1_dex3_pickplace_scene.xml \
  --domain 42 --iface lo --http-port 8782 --initial-fsm 1 --quiet &
(cd .. && G1_WRITE_MODE=arm_sdk G1_LOCO_ENABLED=fsm G1_DDS_DOMAIN=42 G1_DDS_IFACE=lo \
  G1_SIDECAR_PORT=8792 G1_LOWSTATE_ENDPOINT=tcp://127.0.0.1:6999 \
  ~/anaconda3/envs/unitree_sim_env6/bin/python -u g1_sidecar.py &)
~/anaconda3/envs/unitree_sim_env6/bin/python loco_mode_sim_check.py --domain 42 --iface lo \
  --sim http://127.0.0.1:8782 --sidecar http://127.0.0.1:8792
```

`loco_mode_sim_check.py` walks limp → stand → balance, arms, damps the sim
behind the sidecar's back (it must disarm with `left_balance`), and checks that
an E-stop's falling arm_sdk weight reaches the wire before the sim applies
`SetFsmId(1)`. It refuses domain 0, any non-loopback interface, and a sidecar
that reports another domain or gate. The sim drops arm_sdk frames outside
balance (`arm_sdk_ignored_frames` on its `/health`), as the robot did on
2026-10-17; it does not model the sag in damp or the lock-stand physics.

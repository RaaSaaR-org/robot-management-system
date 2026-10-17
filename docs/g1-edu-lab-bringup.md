# G1 EDU 4 Lab-Bringup — Status & Log

> **Platzhalter in diesem Dokument:** `GPU_BOX` = die GPU-Workstation im Lab · `$UNITREE_ROOT` = Wurzel der Unitree-Checkouts und Spike-Daten · `$CONDA_ENVS` = Conda-Env-Verzeichnis. Konkrete Hostnamen, Benutzer und absolute Pfade stehen bewusst nicht im Repo. In PowerShell-Blöcken stehen sie als `$env:UNITREE_ROOT` usw. — vor dem Kopieren als Umgebungsvariablen setzen.

**Stand: 2026-07-03 (Feierabend — Roboter-Akku leer, alle Dienste gestoppt)**
**Box:** GPU_BOX (Windows, NVIDIA-GPU) · **Roboter:** Unitree G1 EDU 4, PC2 = `192.168.123.164` · **Task:** `.mc/tasks/todo/TASK-169`

> **Sicherheits-Direktive (Owner, in Kraft):** Stufe 1 = Daten vom Roboter **nur lesen**.
> Auf keinen Fall schreiben. Technisch erzwungen, nicht nur beabsichtigt (Details unten).

---

## Was heute erreicht wurde

**End-to-end verifiziert: Der reale G1 EDU 4 liefert Live-Telemetrie bis in den 3D-Viewer der App — komplett read-only, mit null Software-Footprint auf dem Roboter.**

Kette: `Roboter (DDS rt/lowstate, Domain 0)` → `g1_state_bridge_readonly.py` (Workstation, ~50 Hz) → `ZMQ :6001` → `g1_sidecar.py :8767 (G1_READ_ONLY)` → `robot-agent g1-edu-4 :41244` → `Server :3001` → `App :1420 (3D-Viewer)`

### 1. RMS auf nativem Windows lauffähig gemacht

- Drei `new URL(import.meta.url).pathname`-Bugs (→ `C:\C:\...`-Pfade) per `fileURLToPath()` gefixt: `robot-agent/src/index.ts`, `robot/StatePersistence.ts`, `robot/state.ts`. Cross-platform korrekt, upstream-würdig.
- `NODE_ENV=development` in `server/.env` (sonst wirft die Compliance-Verschlüsselung im Produktionspfad 500er).

### 2. Sicherheitsanalyse: Stock-Bridge ist für read-only unbrauchbar

Die lerobot-Bridge (`run_g1_server.py`) loopt beim Start `MotionSwitcherClient.ReleaseMode()` — **ein stehender Roboter verliert seinen Balance-Controller und fällt** — und öffnet einen lowcmd-Kommandopfad. `UnitreeG1.connect()` legt ebenfalls einen `rt/lowcmd`-Publisher an. Deshalb Eigenbau:

### 3. Read-only-Architektur gebaut und verifiziert

- **`robot-agent/hardware/g1_state_bridge_readonly.py`** (neu): Subscribed nur `rt/lowstate`, republished als ZMQ PUB :6001 im run_g1_server-Wire-Format. Kein MotionSwitcher, kein Publisher, kein Kommando-Socket — dieser Prozess *kann* konstruktiv keinen einzigen DDS-Befehl senden.
- **`g1_sidecar.py`**: `G1_READ_ONLY`-Modus (**Default AN**) — `POST /action` und `POST /record/start` → HTTP 403 (verifiziert), der lerobot-Treiber wird nie geladen, State kommt per ZMQ-SUB.
- **`robot-agent/.env.g1-edu`** (neu): Agent-Profil `g1-edu-4` (ROBOT_TYPE=g1_edu, Port 41244).

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

- **Alle Dev-Prozesse gestoppt** (Roboter-Akku leer): Bridge, Sidecar, Server, SimBot-Agent, G1-Agent, App. Alle Ports (3001, 41243, 41244, 1420, 8767, 6001) frei.
- **TASK-169:** Stage 0 ✓ (bis auf lerobot/SDK2-Install — erst ab Stage 2 nötig). Stage 1: alle Software-Gates ✓; **einziges offenes Gate: physischer E-Stop-Test**. Stages 2–4 nicht begonnen.
- **Uncommitted** (bewusst, Owner-Entscheid ausstehend): fileURLToPath-Fixes (3 Dateien), Sidecar-Read-only-Umbau + neue Bridge, App-Viewer-Fix (5 Dateien), TASK-169-Updates, `package-lock.json`. Vorschlag: 2–3 Commits (`fix(robot-agent): windows-safe paths`, `feat(robot-agent): read-only G1 telemetry path`, `fix(app): map g1_edu to g1 model in 3D viewer`).

## Neustart-Anleitung (nächste Session, Reihenfolge)

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
#    POST http://localhost:3001/api/robots/register {"robotUrl":"http://localhost:41244"}
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
| `POST /arm {"lease_generation": n}` | Seeds every target from the **measured** pose, weight 0→1 over 1.5 s. 409 `estop_latched`, 503 `no_state` (no fresh `rt/lowstate`). |
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
- Gantry attached for the first session. One person on the hardware e-stop.
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

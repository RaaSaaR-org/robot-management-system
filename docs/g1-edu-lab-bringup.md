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
4. **Optional Stufe 1.5:** Dex3-Hand-Telemetrie ergänzen (separate DDS-Topics `rt/dex3/left|right/state` subscriben) → 43 echte jointStates.
5. **Stage 3 (off-robot):** G1 in die MuJoCo-Sim-Eval-Pipeline; USD-Modelle aus `temp/unitree_model` für Isaac-Sim-Arbeiten (WSL2).
6. **Aufräumen (nice-to-have):** `Model3DTab` toter Code — entfernen oder als Tab mounten.

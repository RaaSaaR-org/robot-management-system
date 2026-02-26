---
id: TASK-082
title: VLA Server Consolidation — Ein Server, ein Client, keine Duplikate
status: done
priority: 1
tags:
- vla
- architecture
- cleanup
depends_on: []
created: 2026-02-26
updated: 2026-02-26
---



# TASK-082 — VLA Server Consolidation

## Problem

Das Repo hat 5 verschiedene VLA-Implementierungen die sich überschneiden:

| Ordner/Datei | Was es ist | Problem |
|---|---|---|
| `smolvla-server/` | HTTP FastAPI Server (Mac M1) | Nur HTTP, ad-hoc, kein gRPC |
| `vla-inference/` | gRPC Server, model-agnostisch, Helm | ML-Deps nicht installiert (auskommentiert), Default-Model ist pi0 (stub), komplexer |
| `robot-agent/smolvla/` | Python HTTP Client | Verbindet zu smolvla-server, nicht zum gRPC Server |
| `robot-agent/src/vla/` | TypeScript gRPC Definitions | Kein funktionierender Client dahinter |
| `vla-tests/client_pi.py` | Subprocess aus anderem Repo | Sidecar ruft das per subprocess auf — Cross-Repo-Dependency |

Resultat: Niemand weiß welcher Server der "echte" ist. Kein Weg ist End-to-End getestet.

## Ziel: Eine saubere Struktur

```
robot-management-system/
└── vla-server/              ← EIN Server, ersetzt alle obigen
    ├── server.py            ← FastAPI HTTP, läuft überall (Mac MPS, Linux CUDA, CPU)
    ├── models/
    │   ├── base.py          ← VLAModel ABC (load / predict / reset / info)
    │   ├── smolvla.py       ← SmolVLA via LeRobot (von vla-inference/ portieren + fixen)
    │   └── pi05.py          ← pi0.5 via LeRobot (für Peters GPU)
    ├── pyproject.toml       ← uv-kompatibel, optionale torch/lerobot deps
    ├── config.yaml.example  ← device: mps | cuda | cpu
    └── README.md            ← Eine klare Setup-Anleitung für Mac UND Linux

robot-agent/hardware/
└── so101_sidecar.py         ← VLA-Loop nativ integriert (kein subprocess client_pi.py)
    └── vla_runner.py        ← NEU: HTTP Client → vla-server, Arm-Control-Loop
```

## Was gelöscht/entfernt wird

- `smolvla-server/` → durch `vla-server/` ersetzt
- `vla-inference/` → SmolVLA model.py portiert nach `vla-server/models/`, Rest weg
- `robot-agent/smolvla/` → durch `vla_runner.py` im Sidecar ersetzt
- `robot-agent/src/vla/proto/` → vorerst weg (gRPC kommt später wenn nötig)
- `robot-agent/test-vla-*.ts` → aufräumen
- Sidecar-Abhängigkeit auf `vla-tests/client_pi.py` → entfernt

## Entscheidung: HTTP statt gRPC (vorerst)

**Warum HTTP:**
- SmolVLA gibt Action-Chunks zurück (50 Actions auf einmal) — kein Streaming nötig
- HTTP ist einfacher, überall testbar, kein Proto-Compile-Step
- Sebastian's Mac läuft bereits mit HTTP, 4-6ms warm inference
- gRPC-Migration später möglich wenn bidirektionales Streaming gebraucht wird

**HTTP API (bleibt wie smolvla-server):**
```
GET  /health    → {"status":"ok","model_loaded":true,"device":"mps"}
GET  /config    → {"action_dim":6,"cameras":["front"],"chunk_size":50}
POST /predict   → {image_b64, state, instruction} → {actions: [[...]×50]}
POST /reset     → {} → {"ok":true}
```

## vla_runner.py — Sidecar-native VLA Loop

Ersetzt den subprocess-Aufruf von `client_pi.py`:

```python
# robot-agent/hardware/vla_runner.py
class VLARunner:
    def __init__(self, server_url: str):
        self.server_url = server_url   # http://192.168.178.40:8000
        self.action_queue = deque()
    
    def start(self, instruction: str):
        """Control loop: camera → server → arm (5 Hz)"""
        while self.running:
            image = capture_camera()
            state = get_joint_state()
            if not self.action_queue:
                chunk = self._predict(image, state, instruction)
                self.action_queue.extend(chunk)
            action = self.action_queue.popleft()
            apply_action(action)
            time.sleep(1/5)
```

Sidecar `/vla/start` startet `VLARunner` als Thread statt `subprocess.Popen(client_pi.py)`.

## Schritte für Devin

1. `vla-server/` Ordner erstellen
   - `server.py`: FastAPI, gleiches HTTP-Interface wie smolvla-server
   - `models/base.py`: VLAModel ABC
   - `models/smolvla.py`: SmolVLA via LeRobot (von vla-inference/models/smolvla.py portieren + fixen für LeRobot 0.4.3 API)
   - `models/pi05.py`: pi0.5 via LeRobot policy_server-Protokoll (stub, TODO für Peters GPU)
   - `pyproject.toml`: `uv pip install -e ".[smolvla]"` installiert torch+lerobot
   - `config.yaml.example`: device, model, port
   - `README.md`: Setup für Mac (MPS) + Linux (CUDA) in einer Datei

2. `robot-agent/hardware/vla_runner.py` erstellen
   - HTTP Client (httpx) → vla-server `/predict`
   - Camera-Capture (picamera2, übernehmen aus client_pi.py)
   - Action-Queue (50 pre-computed actions abarbeiten)
   - Thread-basiert, start/stop via Events
   
3. `so101_sidecar.py` updaten
   - `subprocess.Popen(client_pi.py)` → `VLARunner(server_url=...).start(instruction)`
   - VLA_SERVER_URL aus env oder request-body
   
4. Alte Ordner entfernen
   - `git rm -r smolvla-server/ vla-inference/ robot-agent/smolvla/`
   - TypeScript VLA stubs aufräumen: `robot-agent/src/vla/` → nur VLAManager.ts behalten (für UI-Status)
   - `robot-agent/test-vla-*.ts` löschen
   
5. Tests
   - `vla-server/tests/test_server.py`: Health, Config, Predict mit Mock-Model
   - `robot-agent/hardware/tests/test_vla_runner.py`: Mock-Server, action queue, stop

## Done When

- [ ] `vla-server/` läuft auf Mac mit `uv run python server.py` (device: mps)
- [ ] `vla-server/` läuft auf Linux mit `VLA_DEVICE=cuda uv run python server.py`
- [ ] Sidecar `/vla/start` nutzt VLARunner, nicht mehr client_pi.py subprocess
- [ ] Alle alten VLA-Ordner gelöscht
- [ ] Eine README erklärt Setup für Mac + Linux
- [ ] 0 TS-Fehler, bestehende 265 Tests weiterhin grün
- [ ] End-to-End: `/vla/start` → VLARunner → vla-server → Arm bewegt sich

## Nicht in diesem Task

- gRPC-Migration (später wenn Streaming gebraucht wird)
- pi0.5 full integration (Peters GPU — separater Task nach TASK-078)
- Training Pipeline (TASK-058)

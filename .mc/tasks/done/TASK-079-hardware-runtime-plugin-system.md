---
id: TASK-079
title: 'Architecture: Hardware Runtime Plugin System (Sidecar Evolution)'
status: done
priority: 2
tags:
- architecture
- vla
- hardware
depends_on:
- TASK-082
- TASK-078
created: 2026-02-24
updated: 2026-03-17
---


# TASK-079 — Hardware Runtime Plugin System

---
## 🚨 BLOCKED — Muss TASK-082 zuerst abgeschlossen sein

**Blocked-by: TASK-082 (VLA Server Consolidation)**

Die in TASK-079 geplante Plugin-Architektur (`backends/lerobot_backend.py`, etc.)
ist überholt. TASK-082 definiert die neue Architektur:

- **Server-seitig:** `vla-server/` mit `models/` Ordner statt `backends/` in der Sidecar
- **Client-seitig:** `vla_runner.py` in der Sidecar (HTTP, nicht gRPC)

TASK-079 muss nach TASK-082 **neu bewertet** werden:
- Was von der Plugin-Idee noch sinnvoll ist → in TASK-082-Architektur integrieren
- `backends/` Konzept → wird zu `vla-server/models/` (server-seitig)
- `rclpy` ROS2 backend → später als Modell in `vla-server/models/ros2.py`

**Scope nach TASK-082:** Nur noch Erweiterungen des `vla-server/` für neue Modelle
(GR00T, ROS2) — kein neues Architektur-Design mehr nötig.

---

## Architektur-Entscheidung: Sidecar + Plugins vs. Python Rewrite

### Empfehlung: Sidecar zu "Hardware Runtime" evolvieren — KEIN Python-Rewrite

**Begründung:**

Der Robot Agent hat zwei klar getrennte Verantwortlichkeiten:
- **Management Plane** (TypeScript): A2A-Protokoll, Fleet-Orchestrierung, Compliance, Server-Kommunikation, Telemetrie
- **Hardware Execution Plane** (Python): Arm-Steuerung, Kamera, VLA-Inferenz-Loop

TypeScript ist der richtige Stack für die Management Plane (bestehende ~57 fertige Tasks, A2A-Protokoll, React-Dashboard). Ein Python-Rewrite würde Monate kosten, bestehende Arbeit zerreißen und keinen Vorteil für die Management-Ebene bringen.

Python ist der richtige Stack für Hardware — und das ist genau das was der Sidecar macht.

**Die Antwort auf Sebastians Frage:** Der Sidecar IST schon der Python-Teil des Robot Agent. Er muss nur zu einem richtigen Plugin-System ausgebaut werden.

### Ziel-Architektur

```
Robot Agent (TypeScript, Port 41245)
  └── VLAManager → HTTP → Hardware Runtime (Python, Port 8765)
                             │
                    ┌────────┼────────────┐
                    │        │            │
              LeRobot      GR00T      ROS2
              Backend     Backend    Backend
             (gRPC 8080)  (ZMQ 5555) (rclpy)
                    │        │            │
              GPU Server  GPU Server  ROS2 Network
              (Peter's)   (Peter's)   (lokal oder remote)
```

**Hardware Runtime = erweiterter Sidecar mit:**
```
robot-agent/hardware/
├── so101_sidecar.py          ← bestehend: HTTP API + Arm-Verbindung
├── vla_runner.py             ← bestehend (TASK-077): inference loop
└── backends/                  ← NEU: Plugin-Ordner
    ├── __init__.py
    ├── base.py               ← VLABackend ABC: start/stop/status/get_actions
    ├── lerobot_backend.py    ← gRPC zu LeRobot server (Port 8080)
    ├── groot_backend.py      ← ZMQ/TCP zu GR00T server (Port 5555)
    └── ros2_backend.py       ← rclpy ActionClient (ROS2 native)
```

**Backend Interface (Python ABC):**
```python
class VLABackend(ABC):
    @abstractmethod
    def connect(self, host: str, port: int, config: dict) -> None: ...
    
    @abstractmethod
    def send_observation(self, image: np.ndarray, state: np.ndarray,
                         prompt: str, step: int) -> None: ...
    
    @abstractmethod
    def get_actions(self) -> list[np.ndarray]: ...
    
    @abstractmethod
    def disconnect(self) -> None: ...
```

**Sidecar `/vla/start` API:**
```json
{
  "backend": "lerobot",     // "lerobot" | "groot" | "ros2"
  "host": "100.125.78.40",
  "port": 8080,
  "prompt": "pick up the bottle",
  "cameraIndex": 0,
  "wristCameraIndex": 1,
  "config": {}              // backend-specific options
}
```

### Warum kein Python-Rewrite?

| Aspekt | TypeScript Agent bleibt | Python Rewrite |
|--------|------------------------|----------------|
| Bestehende 57 Tasks | ✅ wiederverwendbar | ❌ alles neu |
| A2A Protokoll | ✅ fertig implementiert | ❌ Python SDK muss gebaut werden |
| Management UI | ✅ React + TypeScript passt | ❌ kein Vorteil |
| Hardware/VLA | Sidecar (Python) ✅ | ✅ nativ, kein Vorteil gegenüber Sidecar |
| ROS2 | rclpy in Sidecar-Plugin ✅ | rclpy direkt, aber Rewrite-Aufwand |
| GR00T SDK | Python plugin ✅ | Python direkt, aber Rewrite-Aufwand |
| Skalierung (Multi-Robot) | Node.js gut für concurrent I/O ✅ | asyncio ok, aber kein Vorteil |
| Einstellbarkeit | TS-Devs oder Robotiker mit klarer Trennung | Muss Robotiker sein |

### ROS2 im Plugin-System

TASK-064 war für `rclnodejs` geplant. Das ist falsch — `rclpy` in einem Python-Backend-Plugin ist die richtige Lösung:

```python
# backends/ros2_backend.py
import rclpy
from rclpy.action import ActionClient
from control_msgs.action import FollowJointTrajectory

class ROS2Backend(VLABackend):
    """Bridges ROS2 FollowJointTrajectory actions to the SO-101 arm."""
    def connect(self, ...): rclpy.init(); ...
    def send_observation(self, ...): ...  # VLA action → ROS2 trajectory goal
    def get_actions(self, ...): ...
```

TASK-064 sollte auf dieses Plugin-Design aktualisiert werden.

## Implementation Steps

1. [ ] `backends/__init__.py` + `backends/base.py` — VLABackend ABC
2. [ ] `backends/lerobot_backend.py` — refactor aus `client_pi.py` LeRobotClient
3. [ ] `so101_sidecar.py` — `/vla/start` nutzt `backends/` statt direkten subprocess
4. [ ] `vla_runner.py` — nutzt backends/ statt hardcodierten LeRobot/OpenPI Code
5. [ ] `backends/groot_backend.py` — nach TASK-076 (GR00T N1 Client)
6. [ ] `backends/ros2_backend.py` — nach TASK-064 (ROS2, mit rclpy statt rclnodejs)
7. [ ] TASK-064 updaten: rclnodejs ersetzen durch rclpy Backend-Plugin

## Done When

- [ ] Neues VLA Backend durch Hinzufügen einer Datei in `backends/` integrierbar
- [ ] LeRobot-Backend als erstes Plugin fertig (end-to-end getestet)
- [ ] TypeScript-Seite: VLAProvider Interface sauber (TASK-077)
- [ ] Keine hardcodierten Backend-Pfade mehr in so101_sidecar.py

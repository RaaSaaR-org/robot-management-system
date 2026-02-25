---
id: TASK-078
title: Peter GPU Server Setup & First End-to-End VLA Test
status: todo
priority: 1
tags: [vla, hardware]
depends_on: []
created: 2026-02-24
---

# TASK-078 — Peter GPU Server Setup & First E2E VLA Test

## Goal

Peter's GTX 5090 (peter-ubuntu, 100.125.78.40) runs the LeRobot policy server.
Pi runs client_pi.py. Arm moves. First real VLA test confirmed.

## Pi-Side Status (Ready ✅)

- Tailscale: aktiv, Peter erreichbar (18–55ms ping)
- LeRobot venv: `~/repos/vla-tests/.venv-lerobot/bin/python` ✅
- OpenPI venv: `~/repos/vla-tests/pi05/client/.venv/` ✅
- Calibration: `~/.cache/huggingface/lerobot/calibration/robots/so_follower/my_so101.json` ✅
- Arm port: `/dev/ttyACM0` ✅
- Server-Readme: `~/repos/vla-tests/pi05/server/README.md`

## Peter's Setup (GPU server — peter-ubuntu)

Peter muss auf seinem Rechner (Linux, GTX 5090, CUDA):

### Option A: LeRobot backend (empfohlen)

```bash
# 1. Install uv (if not present)
curl -LsSf https://astral.sh/uv/install.sh | sh

# 2. Create venv & install LeRobot with policy server
uv venv --python 3.11 .venv-lerobot
source .venv-lerobot/bin/activate
uv pip install "lerobot[feetech,async] @ git+https://github.com/huggingface/lerobot.git"

# 3. Start policy server (loads model on first request from Pi)
python -m lerobot.scripts.server.policy_server \
    --port 8080 \
    --host 0.0.0.0 \
    --device cuda

# Or with explicit checkpoint:
python -m lerobot.scripts.server.policy_server \
    --port 8080 --host 0.0.0.0 --device cuda \
    --pretrained Elvinky/pi05_so101_pick_place_bottle \
    --policy-type pi05
```

### Option B: OpenPI backend (legacy, Franka-trained)

```bash
# See ~/repos/vla-tests/pi05/server/README.md for full setup
# Needs JAX + CUDA + OpenPI checkpoint
```

## Pi Run Command (nach Peter-Setup)

```bash
# LeRobot backend (recommended):
cd ~/repos/vla-tests/pi05/client
source ~/repos/vla-tests/.venv-lerobot/bin/activate
python client_pi.py \
    --backend lerobot \
    --host 100.125.78.40 \
    --port /dev/ttyACM0 \
    --model Elvinky/pi05_so101_pick_place_bottle \
    --policy-type pi05 \
    --prompt "pick up the green object" \
    --hz 5

# OpenPI DROID (if needed):
source ~/repos/vla-tests/pi05/client/.venv/bin/activate
python client_pi.py \
    --backend openpi \
    --host 100.125.78.40 \
    --port /dev/ttyACM0 \
    --config droid \
    --prompt "pick up the cup"
```

## Test Checklist

- [ ] Peter: LeRobot server startet ohne Fehler
- [ ] Pi: `curl http://100.125.78.40:8080` gibt Antwort (port check)
- [ ] Pi: client_pi.py connected (keine Verbindungsfehler in den ersten 10s)
- [ ] Arm: bewegt sich auf Chunk-Empfang hin (auch langsam/falsch ist OK für ersten Test)
- [ ] Latenz: loggt `inference latency=XXXms` — Target: <500ms bei 5Hz
- [ ] Wrist camera: testen mit `--wrist-camera-index 1`

## Troubleshooting

- Port 8080 blockiert: Peter muss Firewall-Regel hinzufügen oder Tailscale sorgt für Routing
- "Missing motor IDs": `--skip-motors wrist_roll` als Fallback
- Kalibrierung falsch: LeRobot versucht zu rekalibrieren → mit `--calibration-file ~/.cache/huggingface/lerobot/calibration/robots/so_follower/my_so101.json` erzwingen

## Done When

- [ ] Arm führt mindestens einen VLA-gesteuerten Bewegungsschritt aus
- [ ] Latenz dokumentiert (inference + round-trip)
- [ ] Ergebnis in MEMORY.md + täglich-Log festgehalten
- [ ] TASK-075 (Production Hardening) danach angehen

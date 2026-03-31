---
id: TASK-117
aliases:
- TASK-117
title: 'Integrierter Teleop-Modus: SO-101 Leader Arm + Browser-UI'
slug: integrierter-teleop-modus-so-101-leader-arm-browser-ui
status: todo
priority: 3
owner: ''
projects: []
customers: []
tags:
- teleoperation
- hardware
- datacollection
sprint: ''
depends_on:
- TASK-116
due_date: ''
created: 2026-03-31
updated: 2026-03-31
---


# Integrierter Teleop-Modus: SO-101 Leader Arm + Browser-UI

## Description

Vollständig integrierter Aufnahme-Modus direkt im RMS — kein Terminal, kein LeRobot CLI. Einfach Leader Arm bewegen, im Browser auf Record drücken, Episoden aufnehmen.

**Hardware-Setup:**
- Leader Arm (SO-101 Follower als Teacher): `/dev/ttyACM1` oder robot0 (192.168.178.82)
- Follower Arm: `/dev/ttyACM0` (Haupt-Pi)
- Beide Arme verbunden → Leader-Bewegungen werden live auf Follower gespiegelt

**Backend — Leader-Sidecar (Erweiterung von `so101_sidecar.py`):**
- Neuer Modus: `leader` — liest Joint-Positionen, sendet nichts an Motoren
- Positionen via WebSocket an RMS pushen (gleiche Struktur wie Follower-Telemetry)
- Alternativ: zweiter Sidecar-Prozess auf Port 8766
- NATS-Event: `hardware.leader.joints` mit `{ joints: number[], timestamp: number }`

**Backend — Teleop Record Endpoint:**
- `POST /api/teleoperation/sessions/:id/record-frame` erweiterern: Leader-Positionen als `observation.state`, Follower-Positionen als `action`
- Oder: WebSocket-Stream direkt in Session schreiben (reduziert HTTP-Overhead)

**Browser-UI (neue Seite `/data-collection/record/:sessionId`):**
- Live Dual-Kamera-View (cam0 + wrist cam, via MJPEG stream oder WebRTC)
- Joint-State Visualisierung: Leader + Follower nebeneinander
- Aufnahme-Steuerung:
  - `[●] Start Episode` / `[■] Stop Episode`
  - `[✗] Discard` (letzte Episode verwerfen)
  - `[✓] Save` (Episode committen)
- Episode-Counter + Qualitäts-Score live
- Keyboard-Shortcuts: `Space` = Start/Stop, `D` = Discard, `S` = Save, `E` = Export

**Keyboard/Gamepad Fallback (kein Leader Arm):**
- WASD / Arrow Keys → inkrementelle Joint-Steuerung
- Gamepad API (Browser-native) für Controller-Support
- Gut für einfache Aufgaben ohne zweiten Arm

**Integration:**
- Am Ende: "Als Dataset speichern" → TASK-116 (auto Dataset-Eintrag)
- Von dort: "Auf HuggingFace publishen" → TASK-115

## Acceptance Criteria
- [ ] Leader Arm bewegen → Follower Arm spiegelt live im Browser sichtbar
- [ ] Episode aufnehmen, stoppen, speichern — alles ohne Terminal
- [ ] Kamera-Feeds live im Browser
- [ ] Aufgenommene Session exportierbar → Dataset (TASK-116)
- [ ] Keyboard-Fallback funktioniert ohne Leader Arm
- [ ] TypeScript: 0 errors

## Notes
@Robert: Hardware-Seite (Leader-Sidecar, Joint-Streaming)
@Devin: Browser-UI, WebSocket-Integration, Record-Endpoints

Referenz: LeRobot `record` CLI, ACT-Teleop, ALOHA bilateral setup

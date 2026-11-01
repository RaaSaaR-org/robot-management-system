---
id: "TASK-444"
aliases: []
title: "A wrist camera publisher serves a USB camera in the head camera's wire format"
slug: "a-wrist-camera-publisher-serves-a-usb-camera-in-the-head"
status: "todo"
priority: 2
owner: "claude"
projects: []
customers: []
tags: ["core"]
sprint: ""
parent: "[[TASK-439]]"
depends_on: []
spe: 3
effort: "medium"
due_date: ""
created: "2026-10-31"
updated: "2026-10-31"
---

# A wrist camera publisher serves a USB camera in the head camera's wire format

## Description

A small, self-contained program that reads one USB (UVC) camera and serves its frames over
TCP in exactly the head camera's wire format, so each wrist camera can run as its own
process on PC2 or on the lab PC, and the sidecar reads it like the head camera.

## Details

### Current state

- The head camera is served by `g1_cam_pub.py` on PC2 (not in this repo; systemd unit
  `g1-head-cam`): V4L2 `/dev/video4`, 640x480@30, port 5600. Wire format per frame:
  `uint32 big-endian length | uint64 big-endian timestamp (ns) | <length> bytes of JPEG`.
  It encodes only while a client is connected, and on USB re-enumeration logs "read failed,
  reopening", recovers, and drops connected clients.
- The sidecar's reader of that format is `robot-agent/hardware/g1_sidecar.py` `pc2cam`
  (~1468-1626); its tests `robot-agent/hardware/tests/test_g1_sidecar_pc2cam.py` contain a
  fake publisher you can mirror.
- PC2 runs Ubuntu 20.04 aarch64, Python 3.8.10. Code under `robot-agent/hardware/` must stay
  Python-3.8/3.9 compatible (`tests/test_fstring_portability.py` enforces f-string rules).
- Unitree's vendor wrist cameras are monocular UVC 640x480@30 (`xr_teleoperate` teleimager
  config); the actual model on g1-edu-4 is not known yet.

### Robot Agent (hardware)

1. New `robot-agent/hardware/camera_pub.py`:
   - CLI: `--device` (path; prefer `/dev/v4l/by-id/...` or `/dev/v4l/by-path/...` so the
     camera keeps its identity across re-enumeration), `--port` (default 5601), `--bind`
     (default `0.0.0.0`), `--width 640 --height 480 --fps 30`, `--quality 85`, `--name`
     (for logs only).
   - Capture via OpenCV `cv2.VideoCapture(device, cv2.CAP_V4L2)` requesting MJPG; import
     cv2 lazily so the module (and its tests) load without OpenCV. Keep the capture behind a
     small interface so tests inject a fake frame source.
   - Encode only while ≥1 client is connected; one encode per frame shared by all clients;
     a slow client is dropped rather than stalling the others; on read failure close,
     wait, reopen (log once per outage), keep serving.
   - SIGTERM/SIGINT → close sockets and the device cleanly.
2. Docs in `docs/g1-edu-lab-bringup.md`, a "Wrist cameras" section: how to find the device
   path (`v4l2-ctl --list-devices`, `ls -l /dev/v4l/by-id`), running it by hand, and a
   systemd unit example (`g1-wrist-cam-left.service` → port 5601, `-right` → 5602) for PC2
   or the lab PC. State plainly that installing on PC2 needs the robot owner's go-ahead.
   Ports 5601/5602 in `docs/network-architecture.md` (PC2 port table, ~142).

## Acceptance Criteria

- [ ] With a fake frame source, a client reading the socket receives frames in the exact
      wire format (length, ns timestamp, valid JPEG), two clients get the same frames, no
      encode happens with zero clients, and a read failure is followed by a reopen.
- [ ] The file imports under Python 3.8 syntax rules (portability test passes) and without
      OpenCV installed.
- [ ] Hardware pytest suite green (`HARDWARE_PYTHON`).

## Test Strategy

New `robot-agent/hardware/tests/test_camera_pub.py` with the fake source; a round-trip test
that points the sidecar's existing pc2cam reader (`G1_PC2_CAMERA_HOST=127.0.0.1`,
`G1_PC2_CAMERA_PORT=<test port>`) at a running publisher and gets a frame through
`/cameras/head_camera/snapshot`. If a USB webcam is attached to the lab PC, a manual check
with the real device (note the result in the PR).

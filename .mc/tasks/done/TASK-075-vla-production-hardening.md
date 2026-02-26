# TASK-075: VLA Production Hardening

**Component:** robot-agent / vla-tests  
**Priority:** High  
**Status:** done

## Problem

The current VLA pipeline (pi0.5 via sidecar → client_pi.py) works in principle but is not production-ready:

1. **Never end-to-end tested** — blocked on Peter's GPU server (OpenPI + pi0.5 checkpoint)
2. **Wrist camera missing** — client_pi.py only sends `front` camera (index 0, IMX477). The SO-101 also has a wrist camera (index 1, OV5647). Most fine-tuned checkpoints expect 2 camera views.
3. **No crash recovery** — if client_pi.py exits unexpectedly, the sidecar doesn't notify the robot-agent; `vla_active` flag stays `true` even though nothing is running
4. **No status webhook** — dashboard shows VLA "running" even after subprocess exits
5. **systemd node services broken** — robot-agent runs as nohup process, not managed; won't survive reboot

## Acceptance Criteria

- [ ] End-to-end test: sidecar spawns client_pi.py → connects to Peter's server → arm moves
- [ ] Wrist camera: `/vla/start` body accepts `wristCameraIndex` (default: 1); `client_pi.py` gets `--wrist-camera-index` arg; `LeRobotClient` sends `observation.images.wrist` in addition to `front`
- [ ] Crash recovery: sidecar watchdog polls subprocess every 2s; if it exits, sets `vla_active=false` and logs returncode (already partially done via existing watchdog, verify it resets state correctly)
- [ ] Status endpoint accuracy: `GET /vla/status` returns `active: false` immediately after subprocess exits (not just at next state poll)
- [ ] systemd fix: robomind-agent.service has correct NVM PATH and absolute ExecStart → `sudo systemctl enable --now robomind-agent`

## Technical Notes

- Wrist camera (OV5647) is at `/dev/video1` or picamera2 index 1
- `client_pi.py` currently hardcodes `camera_index=0`; need `--wrist-camera-index` CLI arg
- `LeRobotClient.send_observation()` currently sends `raw_obs["front"] = image`; add `raw_obs["wrist"] = wrist_image`
- `LeRobotClient.__init__()` needs to add `observation.images.wrist` to `lerobot_features` dict
- Sidecar watchdog at line ~94 already resets `vla_active` when subprocess exits — verify it also sets `vla_process = None`

## Related

- Blocked by: Peter's GPU server setup
- Depends on: TASK-074 (done)
- See: `~/repos/vla-tests/pi05/client/client_pi.py`
- See: `robot-agent/hardware/so101_sidecar.py`

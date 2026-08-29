---
id: TASK-076
aliases:
- TASK-076
title: GR00T N1 Client Integration
slug: groot-n1-client-integration
status: done
priority: 2
owner: ''
projects: []
customers: []
tags:
- extended
- vla
updated: 2026-08-29
---

# TASK-076: GR00T N1 Client Integration

**Component:** vla-server/models/  
**Priority:** Medium  
**Status:** done

---
## Shipped — TASK-082 unblocked this, and the backend landed

**Blocked-by: TASK-082 (VLA Server Consolidation)**

GR00T wird als **Modell-Backend in `vla-server/`** implementiert, nicht als
separater Client in `vla-tests/` oder `robot-agent/`.

**Nach TASK-082 ist der Scope:**
- `vla-server/models/groot.py` → GR00T N1 via ZMQ/TCP (port 5555)
- Gleiche HTTP-Schnittstelle wie SmolVLA (`/predict`, `/health`, `/reset`)
- Sidecar wechselt Model via `VLA_MODEL=groot` env-Variable

Kein neuer Ordner, kein neues Protokoll — nur ein neues `models/groot.py`.

---

## Problem

The `groot/` directory in `vla-tests` only has READMEs — no actual client code exists.  
GR00T uses a completely different protocol from pi0.5:

| | pi0.5 (current) | GR00T N1 |
|---|---|---|
| Protocol | gRPC (LeRobot) / WebSocket (OpenPI) | Custom TCP (ZMQ-based, port 5555) |
| Client lib | `openpi_client`, `lerobot.transport` | `gr00t.policy.server_client.PolicyClient` |
| Observation keys | `observation/image`, `observation/state` | `video.front`, `state.single_arm`, `state.gripper` |
| Action format | `(chunk_size, 6)` absolute degrees | `action.single_arm (h,6)` + `action.gripper (h,1)` |
| Action horizon | 50 steps | 8–16 steps (configurable) |
| Image size | 224×224 padded | N1.5: 224×224, N1.6: native resolution OK |
| Fine-tuning required | Yes (or use SO-101 checkpoint) | Yes (base model = humanoid data) |

## Acceptance Criteria

- [ ] `client_pi.py` gets `--backend groot` option
- [ ] `control_loop_groot()` function added:
  - Connects to `gr00t.policy.server_client.PolicyClient(host, port=5555)`
  - Builds observation dict: `{ "video.front": img, "state.single_arm": joints[:6], "state.gripper": [gripper], "annotation": prompt }`
  - Calls `client.get_action(obs)` → returns `{ "action.single_arm": (h,6), "action.gripper": (h,1) }`
  - Executes action chunk on robot (combine arm + gripper into 6-DOF SO-101 command)
- [ ] Sidecar `/vla/start` passes `--backend groot` when `body.get("backend") == "groot"`
- [ ] Sidecar `/vla/start` passes correct server port (5555 for GR00T, 8080 for lerobot)
- [ ] `isaac-groot` dependency added to `pi05/client/pyproject.toml` (or separate `groot/client/pyproject.toml`)
- [ ] `groot/client/client_groot.py` created (or `client_pi.py --backend groot` covers it)

## Technical Notes

- `gr00t.policy.server_client` is from the [Isaac-GR00T](https://github.com/NVIDIA/Isaac-GR00T) repo
- Install: `pip install "gr00t @ git+https://github.com/NVIDIA/Isaac-GR00T.git"` or via uv
- Observation dict keys must EXACTLY match `modality.json` used during fine-tuning
- Default port: **5555** (not 8080 like LeRobot)
- GR00T requires fine-tuning on SO-101 data before producing useful actions
  - Use [SO-101 fine-tuning blog](https://huggingface.co/blog/nvidia/gr00t-n1-5-so101-tuning) as guide
  - Base checkpoint: `nvidia/GR00T-N1.6-3B`

## Sidecar Changes

```python
# /vla/start body params
backend = body.get("backend", "lerobot")  # "lerobot" | "groot"
default_port = 5555 if backend == "groot" else 8080
server_port = body.get("port", default_port)

cmd = [..., "--backend", backend, "--server-port", str(server_port), ...]
```

## Dependencies / Blockers

- GPU_BOX: needs Isaac-GR00T installed + `run_gr00t_server.py` running
- Fine-tuned SO-101 checkpoint needed for useful behavior
- Depends on: TASK-075 (production hardening first)
- See: `$VLA_TESTS/groot/client/README.md` (architecture docs)
- See: `$VLA_TESTS/groot/server/README.md` (server setup docs)

---

## Where this landed

`vla-server/` was extracted to its own repository after this task was written,
so the deliverable is not in this checkout. It shipped there as:

- `vla-server/models/groot.py` — `GR00TModel(VLAModel)`, 402 lines, talks to the
  Isaac-GR00T PolicyServer over ZMQ on port 5555 as specified
- `vla-server/tests/test_groot.py` — 963 lines of tests
- Registered in `vla-server/server.py`: `model: "smolvla" | "pi05" | "groot" | ...`
  selectable via the `VLA_MODEL` env var, with `groot_host` / `groot_port` /
  `groot_video_keys` settings

The blocker, [[TASK-082]] (VLA Server Consolidation), is `done`.

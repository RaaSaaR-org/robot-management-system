# TASK-076: GR00T N1 Client Integration

**Component:** vla-tests / robot-agent  
**Priority:** Medium  
**Status:** todo

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

- Peter's GPU: needs Isaac-GR00T installed + `run_gr00t_server.py` running
- Fine-tuned SO-101 checkpoint needed for useful behavior
- Depends on: TASK-075 (production hardening first)
- See: `~/repos/vla-tests/groot/client/README.md` (architecture docs)
- See: `~/repos/vla-tests/groot/server/README.md` (server setup docs)

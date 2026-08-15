# API Reference

HTTP endpoints for all NeoDEM services. All protected endpoints require a JWT Bearer token (disabled in dev via `AUTH_DISABLED=true`).

## Hardware Sidecar (port 8765)

Base URL: `http://localhost:8765`

Bridge between the Node.js agent and the SO-101 arm. No authentication.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Connection status. Returns `{status, connected, port}` |
| GET | `/state` | Current joint positions. Returns `{joints[], timestamp, simulated}` |
| GET | `/disconnect` | Release serial port for other tools |
| POST | `/action` | Send joint positions. Body: `{shoulder_pan, shoulder_lift, elbow_flex, wrist_flex, wrist_roll, gripper}` (degrees) |
| POST | `/disconnect` | Release serial port (POST variant) |
| POST | `/vla/start` | Start VLA control loop. Body: `{instruction, serverUrl?, cameraType?, wristCameraIndex?, hz?}` |
| POST | `/vla/stop` | Stop VLA control loop |
| GET | `/vla/status` | VLA runner status. Returns `{active, instruction, step, queue_size, error}` |
| GET | `/safety/status` | Safety metrics. Returns `{validator_enabled, rate_limiter_enabled, watchdog_healthy, ...}` |
| POST | `/safety/config` | Update safety params. Body: `{max_delta_degrees?, watchdog_timeout_ms?}` |

## VLA Server (port 8000)

Base URL: `http://<vla-host>:8000`

VLA model inference server. Runs on a machine with GPU/MPS. No authentication.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Model load status. Returns `{status, model, model_loaded, device}` |
| GET | `/config` | Model config. Returns `{action_dim, chunk_size, cameras[], state_dim}` |
| POST | `/predict` | Run inference. Body: `{images: {name: base64_jpeg}, state: float[], task: string}`. Returns `{actions: float[][], timestamp, inference_time_ms}` |
| POST | `/reset` | Reset model state between episodes |

The `images` field maps camera names to base64-encoded JPEGs. Camera names come from `GET /config`. Legacy `image_b64` field (single image) is still supported.

## Server (port 3001)

Base URL: `http://localhost:3001`

### Public

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/.well-known/a2a/agent_card.json` | A2A agent discovery card |

### Auth (`/api/auth`)

Rate limited: 20 requests per 15 minutes.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/register` | Register user account |
| POST | `/login` | Login. Returns JWT or MFA challenge |
| POST | `/logout` | Invalidate refresh token |
| POST | `/refresh` | Refresh access token |
| GET | `/me` | Current user info |
| POST | `/forgot-password` | Request password reset |
| POST | `/reset-password` | Reset password with token |
| POST | `/change-password` | Change password |
| POST | `/mfa/totp/setup` | Generate TOTP secret |
| POST | `/mfa/totp/verify` | Verify TOTP and enable MFA |
| POST | `/mfa/totp/validate` | Validate TOTP during login |
| POST | `/mfa/recovery-codes` | Generate recovery codes |
| POST | `/mfa/recovery/use` | Use recovery code |
| DELETE | `/mfa/totp` | Disable MFA |
| GET | `/mfa/status` | MFA status |

### Robots (`/api/robots`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/register` | Register robot from URL |
| GET | `/` | List all robots |
| GET | `/:id` | Get robot details |
| DELETE | `/:id` | Unregister robot |
| POST | `/:id/command` | Send command to robot |
| GET | `/:id/telemetry` | Get robot telemetry |
| GET | `/:id/peers` | Every OTHER online robot as `{robotId, name, x, y, headingDeg, frame, place, zone, updatedAt, footprintRadiusM}` for the robot-agent's peer tracker (TASK-207); poses ≤1 s old (refreshed from the agents on demand). `frame` is passed through as reported — the caller drops what it cannot compare |
| GET | `/:id/agent-mode/map` | Proxy of the agent's `GET /api/v1/robots/:id/map` (grid, pose, keepouts, peers, `peersDropped`, `nav` — the navigator's planned route, TASK-208); the agent's 404 ("map disabled") passes through, anything else is a 502 with the agent's error — never an empty map |

### A2A (`/api/a2a`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/agent/register` | Register external A2A agent |
| POST | `/agent/list` | List registered agents |
| DELETE | `/agent/:name` | Unregister agent |
| GET | `/agent/:name` | Get agent details |
| POST | `/conversation/create` | Create conversation with robot |
| POST | `/conversation/list` | List conversations |
| GET | `/conversation/:id` | Get conversation |
| DELETE | `/conversation/:id` | Delete conversation |
| — | `ws://localhost:3001/api/a2a/ws` | WebSocket for messages |

### Training (`/api/training`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/jobs` | Submit training job |
| GET | `/jobs` | List training jobs |
| GET | `/jobs/:id` | Get job details |
| POST | `/jobs/:id/cancel` | Cancel job |
| POST | `/jobs/:id/retry` | Retry failed job |
| GET | `/jobs/:id/estimate` | Estimate duration |
| GET | `/jobs/active` | Active jobs |
| GET | `/queue/stats` | Queue statistics |
| GET | `/workers` | Active training workers + queue summary |

### Datasets (`/api/datasets`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/` | Create dataset |
| GET | `/` | List datasets |
| GET | `/:id` | Get dataset |
| PUT | `/:id` | Update metadata |
| DELETE | `/:id` | Delete dataset |
| POST | `/:id/upload/initiate` | Get presigned upload URL |
| POST | `/:id/upload/complete` | Mark upload done, start validation |
| GET | `/:id/stats` | Normalization stats |
| POST | `/:id/compute-stats` | Trigger stats computation |
| GET | `/:id/progress` | Validation progress |
| GET | `/:id/quality` | Quality report |
| POST | `/:id/validate-advanced` | Trigger advanced validation |

### Deployments (`/api/deployments`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/` | Create deployment |
| GET | `/` | List deployments |
| GET | `/active` | Active deployments |
| GET | `/:id` | Deployment details |
| GET | `/:id/metrics` | Deployment metrics |
| POST | `/:id/start` | Start canary rollout |
| POST | `/:id/progress` | Advance to next stage |
| POST | `/:id/promote` | Promote to production |
| POST | `/:id/rollback` | Trigger rollback |
| POST | `/:id/cancel` | Cancel deployment |

### Compliance (`/api/compliance`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/logs` | List compliance logs (paginated, filterable) |
| GET | `/logs/:id` | Get single log |
| POST | `/logs` | Create log entry (from robot agent) |
| POST | `/verify` | Verify hash chain integrity |
| GET | `/metrics` | Compliance metrics |
| POST | `/sessions` | Start logging session |
| POST | `/export` | Export logs to JSON |

### Other Route Groups

| Base Path | Feature |
|-----------|---------|
| `/api/alerts` | Alert management |
| `/api/zones` | Fleet zone configuration |
| `/api/command` | Natural language command processing |
| `/api/processes` | Workflow management |
| `/api/safety` | E-stop, safety monitoring |
| `/api/explainability` | AI decision transparency |
| `/api/gdpr` | GDPR self-service (Art. 15-22) |
| `/api/incidents` | Incident reporting |
| `/api/oversight` | Human oversight dashboard |
| `/api/approvals` | Human approval workflows |
| `/api/skills` | VLA skill library |
| `/api/embodiments` | Embodiment configuration |
| `/api/teleoperation` | VLA data collection |
| `/api/federated` | Federated learning |
| `/api/contributions` | Data contribution portal |
| `/api/evaluation` | Model evaluation |
| `/api/storage` | Object storage (RustFS/S3) |
| `/api/settings` | User preferences |
| `/api/security` | Device identity, certificates |
| `/api/updates` | OTA update management |

## Robot Agent (port 41245)

Base URL: `http://localhost:41245`

### Public

| Method | Path | Description |
|--------|------|-------------|
| GET | `/.well-known/agent-card.json` | A2A agent card |
| GET | `/api/v1/health` | Health check |
| GET | `/api/v1/register` | Registration info for server |

### Robot Operations (`/api/v1/robots/:id`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Robot details |
| GET | `/telemetry` | Current telemetry |
| GET | `/commands` | Command history |
| POST | `/command` | Send command |
| POST | `/tasks` | Receive pushed task (202) |
| GET | `/tasks` | Task queue |
| DELETE | `/tasks/:taskId` | Cancel task |
| POST | `/reset` | Reset robot state |
| GET | `/map` | The robot's own occupancy grid (TASK-206) + accepted fleet peers and `peersDropped` (TASK-207) + `nav` (TASK-208: `{target, planned, path, goal, lengthM, segments, reason}` while a `goto` runs, else null); `location.frame` on `GET /` says which odometry frame the poses are in |

### Safety (`/api/v1/robots/:id/safety`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Safety status |
| GET | `/estop` | E-stop state |
| POST | `/estop` | Trigger E-stop |
| POST | `/estop/reset` | Reset E-stop |
| GET | `/events` | Safety event log |
| PUT | `/mode` | Set operating mode |
| POST | `/heartbeat` | Server heartbeat |

### VLA Control (`/api/v1/robots/:id/vla`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | VLA control status |
| POST | `/start` | Start VLA. Body: `{instruction}` |
| POST | `/stop` | Stop VLA |
| POST | `/pause` | Pause VLA |
| POST | `/resume` | Resume VLA |
| GET | `/safety` | VLA safety monitoring |
| GET | `/model` | Current model info |
| POST | `/model/switch` | Switch model version |
| GET | `/metrics` | Inference metrics |

### WebSocket

| Path | Description |
|------|-------------|
| `ws://localhost:41245/ws/telemetry/:robotId` | Telemetry stream (2s interval) |
| `ws://localhost:41245/ws/bilateral-teleop` | ALOHA-style teleoperation |

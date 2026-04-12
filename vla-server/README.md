# VLA Server

**Moved to its own repository.** See [`../vla-server/`](../../vla-server/) (local) or the separate `vla-server` repo.

This directory previously contained the FastAPI VLA inference server. It was extracted as part of TASK-150 to enable independent versioning and deployment to GPU machines.

## API (unchanged)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /health | Model load status |
| GET | /config | Model metadata |
| POST | /predict | Run VLA inference |
| POST | /reset | Reset model state |

Default port: **8000**

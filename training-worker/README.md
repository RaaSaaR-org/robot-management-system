# Training Worker

**Moved to its own repository.** See [`../training-worker/`](../../training-worker/) (local) or the separate `training-worker` repo.

This directory previously contained the training worker. It was extracted as part of TASK-150 to enable independent versioning and deployment to GPU machines.

## API (unchanged)

The worker polls the NeoDEM server for training jobs and communicates via:
- `POST /api/training/workers/claim` — claim a job
- `POST /api/training/workers/progress` — report progress
- `POST /api/training/workers/complete` — mark done
- `POST /api/training/workers/heartbeat` — stay alive

Needs access to:
- NeoDEM server (port 3001)
- RustFS/S3 storage (port 9000)

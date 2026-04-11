---
id: TASK-151
aliases:
- TASK-151
title: 'Rust data pipeline: parquet export, dataset stats, validation'
slug: rust-data-pipeline-parquet-stats-validation
status: todo
priority: 3
owner: ''
projects: []
customers: []
sprint: ''
tags:
- core
- deferred
depends_on: []
due_date: ''
created: '2026-04-07'
---

## Description

Build a Rust binary (`neodem-data`) that handles the CPU-bound data pipeline operations: exporting teleoperation frames to LeRobot v3 parquet format, computing dataset statistics, and validating dataset structure. These are currently split across a slow JS parquet library and a serial Python stats worker. Rust with `arrow-rs`/`polars` can do this 10-50x faster with parallel processing.

This is the first concrete Rust component beyond Tauri and the ideal starting point: no ML dependencies, no LeRobot imports, just data transformation — reading/writing parquet, computing math, validating files.

## Why This First

### Performance justification
| Operation | Current | Tool | Speed | Rust estimate |
|-----------|---------|------|-------|---------------|
| Parquet export | `LeRobotExportService.ts` | `@dsnp/parquetjs` (JS) | ~1 MB/s | 50-100 MB/s with `arrow2` |
| Stats computation | `stats_worker.py` | `pyarrow` (serial) | Single-threaded | 4-8x with `rayon` parallelism |
| Dataset validation | `dataset-validation.worker.ts` | Node.js worker | Sequential file checks | Parallel with `rayon` + `tokio` |

### Why it works as standalone Rust
- **No LeRobot dependency** — these operations produce/consume the LeRobot v3 format but don't need LeRobot's Python APIs. The format is just: parquet files + `meta/info.json` + `meta/stats.json` + `meta/episodes.jsonl`
- **No torch dependency** — pure data transformation, no ML
- **Clear input/output** — reads frames from DB/S3, writes parquet + stats JSON
- **Can be called as subprocess** — server spawns it like it already spawns Python scripts (e.g. `evaluate_vla.py`)

## LeRobot v3 Dataset Format (what we produce)

```
dataset/
├── data/
│   ├── train-00000-of-00001.parquet    # Columns: action, observation.state, observation.images.*
│   └── ...
├── meta/
│   ├── info.json          # Feature definitions (names, shapes, dtypes)
│   ├── stats.json         # Per-feature normalization (mean, std, min, max)
│   └── episodes.jsonl     # Episode boundaries (index, start, end)
└── videos/                # Optional MP4 captures
    └── *.mp4
```

**Parquet columns** are typed arrays:
- `action`: float32 array (e.g. 6 joint positions for SO-101)
- `observation.state`: float32 array (current joint state)
- `observation.images.front`: bytes (JPEG-encoded image) or reference to video frame
- `timestamp`: float64
- `episode_index`: int32
- `frame_index`: int32

**Stats format** (`meta/stats.json`):
```json
{
  "action": { "mean": [...], "std": [...], "min": [...], "max": [...] },
  "observation.state": { "mean": [...], "std": [...], "min": [...], "max": [...] }
}
```

## Architecture

### Single Rust binary with subcommands

```
neodem-data export    # Teleoperation frames → LeRobot parquet
neodem-data stats     # Compute mean/std/min/max across parquet files
neodem-data validate  # Validate dataset structure and integrity
neodem-data info      # Print dataset metadata summary
```

### Integration with existing system

```
Server (Node.js)
  │
  ├── neodem-data export --session-id <id> --output s3://datasets/<id>/
  │   (replaces LeRobotExportService.ts)
  │
  ├── neodem-data stats --dataset s3://datasets/<id>/ --output meta/stats.json
  │   (replaces stats_worker.py for the compute part)
  │
  └── neodem-data validate --dataset s3://datasets/<id>/
      (replaces dataset-validation.worker.ts for the heavy lifting)
```

The server spawns `neodem-data` as a subprocess (same pattern as `evaluate_vla.py`), parses JSON-line output for progress, and updates the DB.

### Rust crates to use

| Crate | Purpose |
|-------|---------|
| `arrow` / `parquet` (arrow-rs) | Read/write Apache Parquet files |
| `polars` (alternative) | Higher-level DataFrame API for stats |
| `rayon` | Parallel iteration across files/features |
| `tokio` | Async S3 operations |
| `aws-sdk-s3` | RustFS/S3 object storage |
| `serde` + `serde_json` | JSON serialization (info.json, stats.json, episodes.jsonl) |
| `clap` | CLI argument parsing |
| `image` | JPEG encoding/decoding if needed |
| `indicatif` | Progress bars for CLI usage |

## Subcommand Details

### `neodem-data export`
**Replaces:** `server/src/services/LeRobotExportService.ts`

Input: Teleoperation session data (from server DB via JSON or direct DB query)
Output: LeRobot v3 parquet dataset in S3

Steps:
1. Read session frames (joint positions, actions, timestamps, camera frames)
2. Group into episodes
3. Write parquet files with proper schema (action, observation.state, observation.images.*)
4. Generate `meta/info.json` with feature definitions
5. Generate `meta/episodes.jsonl` with episode boundaries
6. Upload to RustFS
7. Output JSON-line progress to stdout for server to parse

### `neodem-data stats`
**Replaces:** `training-worker/stats_worker.py` (the compute-heavy part)

Input: S3 path to dataset directory
Output: `meta/stats.json`

Steps:
1. List and download parquet files from S3
2. For each numeric feature (action, observation.state):
   - Read all values across all parquet files (streaming, not all in memory)
   - Compute mean, std, min, max using Welford's online algorithm
3. Write `meta/stats.json` in LeRobot v3 format
4. Upload to S3
5. Parallelism: process multiple features in parallel with `rayon`

### `neodem-data validate`
**Replaces:** `server/src/workers/dataset-validation.worker.ts`

Input: S3 path to dataset directory
Output: Validation report (JSON)

Checks:
1. Required files exist: `meta/info.json`, `data/*.parquet`
2. Parquet schema matches info.json feature definitions
3. Episode boundaries in `episodes.jsonl` are consistent with data
4. No NaN/Inf values in numeric columns
5. Frame counts match across features
6. Optional: stats.json values are reasonable (no zero std, etc.)
7. Quality score computation (demo count, duration, diversity, format compliance)

### `neodem-data info`
Quick metadata summary — useful for debugging and CLI workflows.

## Key Files (current implementations to replace)

### Parquet export (JS → Rust)
- `server/src/services/LeRobotExportService.ts` — current JS implementation using `@dsnp/parquetjs`
- Dependencies: `@dsnp/parquetjs` in `server/package.json`

### Stats computation (Python → Rust)
- `training-worker/stats_worker.py` — current Python implementation
- Uses: `pyarrow.parquet.read_table()`, `numpy` for mean/std
- Consumes NATS messages from `jobs.dataset.compute-stats`
- Server integration: `server/src/services/TrainingOrchestrator.ts` triggers stats jobs

### Dataset validation (JS → Rust)
- `server/src/workers/dataset-validation.worker.ts` — current Node.js worker
- Uses NATS JetStream consumer
- Quality scoring algorithm (4-component weighted)

### Server integration points
- `server/src/services/DatasetService.ts` — calls export + validation
- `server/src/routes/training.routes.ts` — triggers stats computation
- `server/src/messaging/NatsClient.ts` — publishes stats jobs to NATS

## Migration Path

### Phase 1: Build the binary
- Implement `neodem-data stats` first (smallest scope, clearest input/output)
- Test against existing datasets in RustFS
- Compare output with Python stats_worker output (must produce identical stats.json)

### Phase 2: Integrate stats
- Server calls `neodem-data stats` as subprocess instead of publishing NATS message to Python worker
- Keep Python stats_worker as fallback (feature flag: `STATS_BACKEND=rust|python`)

### Phase 3: Add export + validate
- Implement `neodem-data export` replacing LeRobotExportService.ts
- Implement `neodem-data validate` replacing dataset-validation.worker.ts
- Server spawns Rust binary for these operations

### Phase 4: Package
- Add to Tauri sidecar (so desktop app bundles it)
- Add Dockerfile for server deployments
- Add to CI/CD pipeline

## Test Strategy

- **Unit tests**: Rust tests for parquet read/write, stats computation, validation rules
- **Integration test**: Generate a known dataset, compute stats with both Python and Rust, assert identical output
- **E2E test**: Upload a dataset via the app, verify stats are computed by Rust binary, appear correctly in UI
- **Benchmark**: Compare wall-clock time of Rust vs Python/JS for a real dataset (expect 10x+ improvement)

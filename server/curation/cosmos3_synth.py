#!/usr/bin/env python3
"""TASK-175 — Cosmos 3 synthetic-data generation -> LeRobot dataset augmentation.

Two subcommands:

  generate   Call the HF ZeroGPU Action-Viewer (forward dynamics) to roll out
             action-conditioned video for a supported embodiment (bridge/WidowX).
             Saves one mp4 + action.json + meta per synthetic episode into RAW_DIR.

  convert    Turn the RAW_DIR artifacts into a valid LeRobot v2.1 on-disk dataset
             (meta/info.json + data/chunk-000/episode_*.parquet + videos), the
             exact layout our dataset-validation worker checks
             (server/src/services/DatasetService.ts validateStructure).

Why this shape: HF PRO gives 40 ZeroGPU GPU-min/day; each forward-dynamics job is
~150-200s, so a handful of episodes/day is free-with-PRO. This proves the pipeline
end-to-end before any rented-GPU spend (RES-001 §4.2-4.3 for scale).

Run generate in the BACKGROUND (jobs exceed a 120s shell timeout):
  .venv/bin/python cosmos3_synth.py generate --episodes 3
  .venv/bin/python cosmos3_synth.py convert
"""
from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import subprocess
import time
import uuid
from pathlib import Path

import httpx
import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq

HERE = Path(__file__).resolve().parent
SPACE = "nvidia/Cosmos3-Action-Viewer-Prerelease"
BASE_URL = "https://" + SPACE.replace("/", "-").lower() + ".hf.space"
# bridge (WidowX) example LeRobot dataset packaged inside the Space — its real
# `action` column is the source of valid action chunks. Downloaded on demand.
BRIDGE_PARQUET_IN_SPACE = "assets/examples/bridge_lerobot_v3/data/chunk-000/file-000.parquet"
CACHE_DIR = HERE / "space_src"
RAW_DIR = HERE / "task175_out" / "raw"
DATASET_DIR = HERE / "task175_out" / "lerobot_cosmos_bridge"


def _bridge_parquet_path() -> Path:
    """Return the bridge example parquet, downloading it from the Space if absent."""
    local = CACHE_DIR / BRIDGE_PARQUET_IN_SPACE
    if local.exists():
        return local
    from huggingface_hub import hf_hub_download
    tok = os.environ.get("HF_TOKEN")
    p = hf_hub_download(SPACE, BRIDGE_PARQUET_IN_SPACE, repo_type="space",
                        token=tok, local_dir=str(CACHE_DIR))
    return Path(p)
CODEBASE_VERSION = "v2.1"
CHUNK_SIZE = 1000
ROBOT_TYPE = "widowx_bridge"            # bridge embodiment (WidowX 250)
FPS = 5                                  # bridge native fps (from its info.json)


def load_env() -> None:
    env = HERE / ".env"
    if not env.exists():
        return
    for line in env.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())


# ---- action representation: LeRobot bridge action (7) -> model space (10) ----
# bridge model action_dim=10 (quantile_rot): [tx,ty,tz, 6D-rotation, gripper].
# The LeRobot column is [tx,ty,tz, rx,ry,rz(euler delta), gripper]; convert euler->6D.
def _euler_to_6d(rx: float, ry: float, rz: float) -> list[float]:
    ca, sa = math.cos(rx), math.sin(rx)
    cb, sb = math.cos(ry), math.sin(ry)
    cc, sc = math.cos(rz), math.sin(rz)
    Rx = np.array([[1, 0, 0], [0, ca, -sa], [0, sa, ca]])
    Ry = np.array([[cb, 0, sb], [0, 1, 0], [-sb, 0, cb]])
    Rz = np.array([[cc, -sc, 0], [sc, cc, 0], [0, 0, 1]])
    R = Rz @ Ry @ Rx
    return [R[0, 0], R[1, 0], R[2, 0], R[0, 1], R[1, 1], R[2, 1]]  # first two columns


def _to10(a7: list[float]) -> list[float]:
    tx, ty, tz, rx, ry, rz, grip = a7
    return [tx, ty, tz, *_euler_to_6d(rx, ry, rz), grip]


def _bridge_actions_by_episode() -> dict[int, list[list[float]]]:
    t = pq.read_table(_bridge_parquet_path())
    eps = t.column("episode_index").to_pylist()
    act = t.column("action").to_pylist()
    by: dict[int, list[list[float]]] = {}
    for e, a in zip(eps, act):
        by.setdefault(int(e), []).append([float(x) for x in a])
    return by


def _gen_plan(n: int, prompt: str | None = None) -> list[dict]:
    """Build n distinct synthetic-episode requests from real bridge action chunks.

    If `prompt` is given it overrides the cycled default task descriptions (used
    by the in-app generator wizard, TASK-178).
    """
    by = _bridge_actions_by_episode()
    ep_ids = sorted(by)
    prompts = [
        "A WidowX robot arm picks up an object from the tabletop.",
        "A WidowX robot arm places an object into the container.",
        "A WidowX robot arm reaches toward and grasps an item on the table.",
    ]
    plan = []
    for i in range(n):
        src_ep = ep_ids[i % len(ep_ids)]
        rows7 = by[src_ep]
        start = (i // len(ep_ids)) * 4          # window shift for repeats
        chunk7 = rows7[start:start + 16] or rows7[:16]
        plan.append({
            "gen_id": f"task175-bridge-{i:02d}",
            "dataset": "bridge",
            "baked_action_7d": chunk7,          # raw LeRobot rows (for our parquet)
            "baked_action": [_to10(r) for r in chunk7],
            "prompt_description": (prompt.strip() if prompt and prompt.strip()
                                   else prompts[i % len(prompts)]),
            "num_steps": 30,
            "guidance": 1.0,
            "seed": i,
        })
    return plan


def _call_generate(cli: httpx.Client, tok: str, req: dict) -> tuple[dict, list]:
    """Raw gradio HTTP API (POST + SSE). Returns (generation_result, output_array).

    We bypass gradio_client because its auto-download of file outputs trips over
    the Space's restricted file route (403 on a checkpoint path in the result
    JSON). The raw API hands back clean /gradio_api/file= URLs we fetch ourselves.
    """
    H = {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}
    r = cli.post(f"{BASE_URL}/gradio_api/call/generate", headers=H, json={"data": [json.dumps(req)]})
    r.raise_for_status()
    eid = r.json()["event_id"]
    event = data = None
    with cli.stream("GET", f"{BASE_URL}/gradio_api/call/generate/{eid}",
                    headers={"Authorization": f"Bearer {tok}"}) as s:
        for line in s.iter_lines():
            if not line:
                continue
            if line.startswith("event:"):
                event = line.split(":", 1)[1].strip()
            elif line.startswith("data:"):
                data = line[5:].strip()
                if event in ("complete", "error"):
                    break
    if event == "error":
        return {"ok": False, "status": "sse_error", "error": (data or "")[:300]}, []
    arr = json.loads(data)
    return (arr[0] if arr else {"ok": False, "error": "empty"}), arr


def _download(cli: httpx.Client, tok: str, url: str) -> bytes:
    r = cli.get(url, headers={"Authorization": f"Bearer {tok}"})
    r.raise_for_status()
    return r.content


def cmd_generate(args) -> int:
    load_env()
    tok = os.environ.get("HF_TOKEN")
    if not tok:
        print("ERROR: HF_TOKEN missing in .env (PRO token needed for the GPU job).")
        return 2
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    plan = _gen_plan(args.episodes, getattr(args, "prompt", None))
    print(f"== generating {len(plan)} synthetic episode(s) via {SPACE} ==", flush=True)
    manifest = []
    with httpx.Client(timeout=600) as cli:
        for spec in plan:
            gid = spec["gen_id"]
            jobdir = RAW_DIR / gid
            jobdir.mkdir(parents=True, exist_ok=True)
            req = {
                "dataset": spec["dataset"],
                "baked_action": spec["baked_action"],
                "model_mode": "forward_dynamics",
                "prompt_description": spec["prompt_description"],
                "num_steps": spec["num_steps"],
                "guidance": spec["guidance"],
                "seed": spec["seed"],
                # unique per run: the Space keeps a server-side dir named by
                # generation_id and errors (FileExistsError) if it already exists.
                "generation_id": f"{gid}-{uuid.uuid4().hex[:8]}",
            }
            print(f"\n-- {gid}: {spec['prompt_description']} (chunk={len(spec['baked_action'])}, seed={spec['seed']})", flush=True)
            result_json, arr, dt = {}, [], 0.0
            for attempt in range(1, 3):  # retry transient GPU/queue aborts once
                # fresh generation_id per attempt: the Space errors (FileExistsError)
                # if a retry reuses an id whose server-side dir already exists.
                req["generation_id"] = f"{gid}-{uuid.uuid4().hex[:8]}"
                t0 = time.monotonic()
                try:
                    result_json, arr = _call_generate(cli, tok, req)
                except Exception as e:
                    result_json, arr = {"ok": False, "status": "exception", "error": f"{type(e).__name__}: {e}"}, []
                dt = time.monotonic() - t0
                if result_json.get("ok"):
                    break
                print(f"   attempt {attempt} failed: {result_json.get('status')} {str(result_json.get('error'))[:120]}", flush=True)
            ok = bool(result_json.get("ok"))
            print(f"   {dt:.1f}s ok={ok} status={result_json.get('status')}", flush=True)
            if not ok:
                manifest.append({"gen_id": gid, "ok": False, "latency_s": round(dt, 1),
                                 "error": result_json.get("error")})
                continue
            # download video + action json via token
            try:
                if len(arr) > 1 and arr[1] and arr[1].get("url"):
                    (jobdir / "video.mp4").write_bytes(_download(cli, tok, arr[1]["url"]))
                if len(arr) > 2 and arr[2] and arr[2].get("url"):
                    (jobdir / "model_action.json").write_bytes(_download(cli, tok, arr[2]["url"]))
            except Exception as e:
                print(f"   download FAILED: {type(e).__name__}: {e}", flush=True)
                manifest.append({"gen_id": gid, "ok": False, "error": f"download: {e}"})
                continue
            # a result without a video url leaves video.mp4 unwritten — treat as a
            # generation failure, not a success (an ok:True here poisons convert).
            if not (jobdir / "video.mp4").exists():
                print("   no video url in result", flush=True)
                manifest.append({"gen_id": gid, "ok": False, "latency_s": round(dt, 1),
                                 "error": "no video url in result"})
                continue
            (jobdir / "request.json").write_text(json.dumps(req, indent=2))
            (jobdir / "baked_action_7d.json").write_text(json.dumps(spec["baked_action_7d"]))
            (jobdir / "result.json").write_text(json.dumps(result_json, indent=2))
            manifest.append({
                "gen_id": gid, "ok": True, "latency_s": round(dt, 1),
                "dataset": spec["dataset"], "prompt": spec["prompt_description"],
                "seed": spec["seed"], "num_steps": spec["num_steps"],
                "video": str(jobdir / "video.mp4"),
            })
    (RAW_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2))
    ok_n = sum(1 for m in manifest if m.get("ok"))
    print(f"\n== generate DONE: {ok_n}/{len(plan)} succeeded -> {RAW_DIR}/manifest.json ==", flush=True)
    return 0 if ok_n else 1


# --------------------------- LeRobot v2.1 converter ---------------------------
def _ffprobe_dims(mp4: Path) -> tuple[int, int]:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
         "stream=width,height", "-of", "csv=p=0:s=x", str(mp4)],
        capture_output=True, text=True, check=True).stdout.strip()
    w, h = out.split("x")
    return int(w), int(h)


def _frame_count(mp4: Path) -> int:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-count_frames",
         "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", str(mp4)],
        capture_output=True, text=True, check=True).stdout.strip()
    try:
        return int(out)
    except (ValueError, TypeError):
        return 0


def cmd_convert(args) -> int:
    manifest_path = RAW_DIR / "manifest.json"
    if not manifest_path.exists():
        print(f"ERROR: no manifest at {manifest_path} — run `generate` first.")
        return 2
    manifest = [m for m in json.loads(manifest_path.read_text()) if m.get("ok")]
    if not manifest:
        print("ERROR: no successful generations to convert.")
        return 1

    if DATASET_DIR.exists():
        shutil.rmtree(DATASET_DIR)
    data_dir = DATASET_DIR / "data" / "chunk-000"
    meta_dir = DATASET_DIR / "meta"
    data_dir.mkdir(parents=True, exist_ok=True)
    meta_dir.mkdir(parents=True, exist_ok=True)

    action_dim = 7  # we store the human-readable LeRobot bridge action (3 trans + 3 euler + 1 grip)
    state_dim = 7
    tasks: list[str] = []
    episodes_meta = []
    global_index = 0
    total_videos = 0
    vid_h = vid_w = None

    for m in manifest:
        # episode index = number converted so far, so a skipped episode never
        # leaves a gap in the on-disk episode_NNNNNN sequence.
        ep = len(episodes_meta)
        try:
            jobdir = RAW_DIR / m["gen_id"]
            mp4 = jobdir / "video.mp4"
            baked7 = json.loads((jobdir / "baked_action_7d.json").read_text())
            nframes = _frame_count(mp4)
            if nframes <= 0:
                raise ValueError(f"no decodable frames in {mp4}")
            if vid_w is None:
                vid_w, vid_h = _ffprobe_dims(mp4)

            # actions: real bridge chunk, tiled/truncated to match generated frame count
            acts = [baked7[i % len(baked7)] for i in range(nframes)]
            # observation.state: integrate the delta actions into a running pose proxy (3 trans+3 rot)+grip
            state = [0.0] * 6
            states = []
            for a in acts:
                for j in range(6):
                    state[j] += a[j]
                states.append(state[:6] + [a[6]])

            task = m["prompt"]
            if task not in tasks:
                tasks.append(task)
            task_index = tasks.index(task)

            cols = {"observation.state": [], "action": [], "timestamp": [], "frame_index": [],
                    "episode_index": [], "index": [], "task_index": []}
            for f in range(nframes):
                cols["observation.state"].append([float(x) for x in states[f]])
                cols["action"].append([float(x) for x in acts[f]])
                cols["timestamp"].append(round(f / FPS, 6))
                cols["frame_index"].append(f)
                cols["episode_index"].append(ep)
                cols["index"].append(global_index + f)
                cols["task_index"].append(task_index)

            table = pa.table({
                "observation.state": pa.array(cols["observation.state"], type=pa.list_(pa.float32())),
                "action": pa.array(cols["action"], type=pa.list_(pa.float32())),
                "timestamp": pa.array(cols["timestamp"], type=pa.float32()),
                "frame_index": pa.array(cols["frame_index"], type=pa.int64()),
                "episode_index": pa.array(cols["episode_index"], type=pa.int64()),
                "index": pa.array(cols["index"], type=pa.int64()),
                "task_index": pa.array(cols["task_index"], type=pa.int64()),
            })
            pq.write_table(table, data_dir / f"episode_{ep:06d}.parquet")

            # copy the generated video into the LeRobot videos/ layout
            vid_out = DATASET_DIR / "videos" / "observation.images.image_0" / "chunk-000"
            vid_out.mkdir(parents=True, exist_ok=True)
            shutil.copy(mp4, vid_out / f"episode_{ep:06d}.mp4")
            total_videos += 1
            global_index += nframes  # only commit frame count on full success

            episodes_meta.append({"episode_index": ep, "tasks": [task], "length": nframes})
            print(f"  ep{ep}: {nframes} frames, {vid_w}x{vid_h}  <- {m['gen_id']}")
        except Exception as e:
            # isolate per-episode failures so one bad video can't abort the batch.
            print(f"  WARN: skipping {m.get('gen_id')}: {type(e).__name__}: {e}")
            continue

    # re-derive batch totals from only the episodes that actually converted.
    n_episodes = len(episodes_meta)
    if n_episodes == 0:
        print("ERROR: no episodes converted successfully.")
        return 1

    info = {
        "codebase_version": CODEBASE_VERSION,
        "robot_type": ROBOT_TYPE,
        "fps": FPS,
        "total_episodes": n_episodes,
        "total_frames": global_index,
        "total_tasks": len(tasks),
        "total_videos": total_videos,
        "total_chunks": 1,
        "chunks_size": CHUNK_SIZE,
        "data_path": "data/chunk-{episode_chunk:03d}/episode_{episode_index:06d}.parquet",
        "video_path": "videos/{video_key}/chunk-{episode_chunk:03d}/episode_{episode_index:06d}.mp4",
        "splits": {"train": f"0:{n_episodes}"},
        "features": {
            "observation.images.image_0": {"dtype": "video", "shape": [vid_h, vid_w, 3], "names": ["height", "width", "channel"]},
            "observation.state": {"dtype": "float32", "shape": [state_dim], "names": None},
            "action": {"dtype": "float32", "shape": [action_dim], "names": None},
            "timestamp": {"dtype": "float32", "shape": [1], "names": None},
            "frame_index": {"dtype": "int64", "shape": [1], "names": None},
            "episode_index": {"dtype": "int64", "shape": [1], "names": None},
            "index": {"dtype": "int64", "shape": [1], "names": None},
            "task_index": {"dtype": "int64", "shape": [1], "names": None},
        },
        "_generator": "nvidia/Cosmos3-Nano via Cosmos3-Action-Viewer-Prerelease (forward_dynamics)",
        "_synthetic": True,
    }
    (meta_dir / "info.json").write_text(json.dumps(info, indent=2))
    # episodes.json (array) — validateStructure checks for this exact name;
    # episodes.jsonl kept too for LeRobot tooling compatibility.
    (meta_dir / "episodes.json").write_text(json.dumps(episodes_meta, indent=2))
    with (meta_dir / "episodes.jsonl").open("w") as fh:
        for e in episodes_meta:
            fh.write(json.dumps(e) + "\n")
    with (meta_dir / "tasks.jsonl").open("w") as fh:
        for i, tname in enumerate(tasks):
            fh.write(json.dumps({"task_index": i, "task": tname}) + "\n")

    # stats.json (mean/std/min/max per feature) — optional but +quality points.
    # Recompute straight from the parquet we just wrote.
    st_all, ac_all = [], []
    for ep in range(n_episodes):
        tt = pq.read_table(data_dir / f"episode_{ep:06d}.parquet")
        st_all += tt.column("observation.state").to_pylist()
        ac_all += tt.column("action").to_pylist()
    st_np, ac_np = np.array(st_all, dtype=float), np.array(ac_all, dtype=float)
    stats = {
        "observation.state": {"mean": st_np.mean(0).tolist(), "std": (st_np.std(0) + 1e-8).tolist(),
                               "min": st_np.min(0).tolist(), "max": st_np.max(0).tolist()},
        "action": {"mean": ac_np.mean(0).tolist(), "std": (ac_np.std(0) + 1e-8).tolist(),
                   "min": ac_np.min(0).tolist(), "max": ac_np.max(0).tolist()},
    }
    (meta_dir / "stats.json").write_text(json.dumps(stats, indent=2))

    print(f"\n== convert DONE: {n_episodes} episodes, {global_index} frames -> {DATASET_DIR} ==")
    print("   layout: meta/info.json, meta/episodes.jsonl, meta/tasks.jsonl, meta/stats.json,")
    print("           data/chunk-000/episode_*.parquet, videos/observation.images.image_0/chunk-000/*.mp4")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=str(HERE / "cosmos3_out"),
                    help="Output root (raw rollouts, cache, exported dataset). Default: ./cosmos3_out")
    sub = ap.add_subparsers(dest="cmd", required=True)
    g = sub.add_parser("generate")
    g.add_argument("--episodes", type=int, default=3)
    g.add_argument("--prompt", default=None,
                   help="Override the cycled task description for all episodes.")
    g.set_defaults(func=cmd_generate)
    c = sub.add_parser("convert")
    c.set_defaults(func=cmd_convert)
    args = ap.parse_args()

    global RAW_DIR, DATASET_DIR, CACHE_DIR
    out = Path(args.out)
    RAW_DIR = out / "raw"
    DATASET_DIR = out / "lerobot_cosmos_bridge"
    CACHE_DIR = out / "space_src"
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())

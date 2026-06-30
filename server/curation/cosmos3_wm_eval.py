#!/usr/bin/env python3
"""TASK-176 — Cosmos 3 world-model simulator feasibility study.

Question: can Cosmos 3 forward dynamics act as a *learned world-model simulator*
to rank policies, complementing the geometric MuJoCo sim-RL evaluator
(TASK-172.C, robot-agent/hardware/sim_evaluator/)?

Method (no framework internals, no windowing assumptions):
  For each recorded sequence we roll out the SAME conditioning frame under
  several "policies": the REAL recorded actions plus deliberately-corrupted
  variants (scrambled / reversed / zero). A faithful, action-sensitive world
  model must (a) reproduce the REAL future best and (b) order real > corrupted.

  Predicted frames are auto-aligned to ground truth by matching the conditioning
  frame (predicted[0]) against every ground-truth frame — so we never assume how
  the Space maps `sample_index` to dataset frames.

Subcommands:
  rollout    GPU. Per sequence: emit a zero-action probe (recovers the true
             conditioning frame index d), then real/scrambled/reversed rollouts
             driven by the real action chunk that actually starts at d.
  score      No GPU. SSIM/PSNR predicted-vs-ground-truth + motion + per-sequence
             ranking -> report.json + REPORT.md + qualitative frame strips.
  selftest   No GPU/network. Validates the SSIM/PSNR math on synthetic frames.

Run rollout in the BACKGROUND (GPU jobs exceed a 120s shell timeout):
  .venv/bin/python cosmos3_wm_eval.py --out wm_out rollout --seqs 0,6
  .venv/bin/python cosmos3_wm_eval.py --out wm_out score
"""
from __future__ import annotations

import argparse
import json
import math
import os
import subprocess
import uuid
from pathlib import Path

import httpx
import numpy as np
import pyarrow.parquet as pq

import cosmos3_synth as c3  # reuse the proven GPU-call + action helpers

HERE = Path(__file__).resolve().parent
SPACE = c3.SPACE
BASE_URL = c3.BASE_URL
FPS = c3.FPS
GT_VIDEO_IN_SPACE = ("assets/examples/bridge_lerobot_v3/videos/"
                     "observation.images.image_0/chunk-000/file-000.mp4")
ACTION_CHUNK = 16
NUM_STEPS = 30
GUIDANCE = 1.0
SEED = 0  # fixed across variants of a sequence -> identical conditioning
# corrupted "policies" tested against the real recorded actions
VARIANTS = ["zero", "real", "scrambled", "reversed"]

# set at runtime from --out
OUT = HERE / "wm_out"
RAW = OUT / "raw"
CACHE = OUT / "space_src"


# --------------------------------------------------------------------------- #
# data: bridge ground-truth video + global action stream
# --------------------------------------------------------------------------- #
def _gt_video_path() -> Path:
    local = CACHE / GT_VIDEO_IN_SPACE
    if local.exists():
        return local
    from huggingface_hub import hf_hub_download
    p = hf_hub_download(SPACE, GT_VIDEO_IN_SPACE, repo_type="space",
                        token=os.environ.get("HF_TOKEN"), local_dir=str(CACHE))
    return Path(p)


def _bridge_actions_global() -> list[list[float]]:
    """Real 7-D LeRobot bridge actions in dataset row order (both episodes)."""
    c3.CACHE_DIR = CACHE
    t = pq.read_table(c3._bridge_parquet_path())
    return [[float(x) for x in a] for a in t.column("action").to_pylist()]


# --------------------------------------------------------------------------- #
# frames: read mp4 -> numpy via ffmpeg rawvideo (no Pillow/imageio dep)
# --------------------------------------------------------------------------- #
def _dims(mp4: Path) -> tuple[int, int]:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
         "stream=width,height", "-of", "csv=p=0:s=x", str(mp4)],
        capture_output=True, text=True, check=True).stdout.strip()
    w, h = out.split("x")
    return int(w), int(h)


def _read_frames(mp4: Path) -> np.ndarray:
    w, h = _dims(mp4)
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(mp4), "-f", "rawvideo",
         "-pix_fmt", "rgb24", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(-1, h, w, 3)


def _gray(rgb: np.ndarray) -> np.ndarray:
    return (rgb[..., 0] * 0.299 + rgb[..., 1] * 0.587 + rgb[..., 2] * 0.114).astype(np.float32)


# --------------------------------------------------------------------------- #
# metrics: dependency-light PSNR + windowed SSIM (numpy only)
# --------------------------------------------------------------------------- #
def _psnr(a: np.ndarray, b: np.ndarray) -> float:
    mse = float(np.mean((a - b) ** 2))
    return float("inf") if mse == 0 else 10.0 * math.log10(255.0 * 255.0 / mse)


def _box(img: np.ndarray, w: int) -> np.ndarray:
    from numpy.lib.stride_tricks import sliding_window_view
    return sliding_window_view(img, (w, w)).mean(axis=(-1, -2))


def _ssim_map(a: np.ndarray, b: np.ndarray, win: int = 7) -> np.ndarray:
    """Per-window SSIM map on luminance, uniform window (numpy-only, rough)."""
    C1, C2 = (0.01 * 255) ** 2, (0.03 * 255) ** 2
    mu_a, mu_b = _box(a, win), _box(b, win)
    mu_a2, mu_b2, mu_ab = mu_a * mu_a, mu_b * mu_b, mu_a * mu_b
    va = _box(a * a, win) - mu_a2
    vb = _box(b * b, win) - mu_b2
    vab = _box(a * b, win) - mu_ab
    smap = ((2 * mu_ab + C1) * (2 * vab + C2)) / ((mu_a2 + mu_b2 + C1) * (va + vb + C2))
    return np.clip(smap, -1, 1)


def _ssim(a: np.ndarray, b: np.ndarray, win: int = 7) -> float:
    return float(_ssim_map(a, b, win).mean())


def _detect_cond_index(pred0_gray: np.ndarray, gt_gray: np.ndarray) -> int:
    """Find the GT frame the predicted clip starts from (the conditioning frame)."""
    return int(np.argmin([float(np.mean((pred0_gray - g) ** 2)) for g in gt_gray]))


# --------------------------------------------------------------------------- #
# action variants ("policies")
# --------------------------------------------------------------------------- #
def _variant_actions(real7: list[list[float]], variant: str) -> list[list[float]]:
    if variant == "real":
        return real7
    if variant == "reversed":
        return real7[::-1]
    if variant == "zero":
        return [[0.0] * 7 for _ in real7]
    if variant == "scrambled":
        perm = np.random.RandomState(12345).permutation(len(real7))
        return [real7[i] for i in perm]
    raise ValueError(variant)


# --------------------------------------------------------------------------- #
# rollout (GPU)
# --------------------------------------------------------------------------- #
def _gen(cli: httpx.Client, tok: str, sample_index: int, actions7: list[list[float]],
         prompt: str, gid: str, jobdir: Path) -> dict:
    req = {
        "dataset": "bridge",
        "sample_index": sample_index,
        "baked_action": [c3._to10(r) for r in actions7],
        "model_mode": "forward_dynamics",
        "prompt_description": prompt,
        "num_steps": NUM_STEPS,
        "guidance": GUIDANCE,
        "seed": SEED,
        "generation_id": f"{gid}-{uuid.uuid4().hex[:8]}",
    }
    result, arr = {}, []
    for attempt in range(1, 3):
        try:
            result, arr = c3._call_generate(cli, tok, req)
        except Exception as e:
            result, arr = {"ok": False, "error": f"{type(e).__name__}: {e}"}, []
        if result.get("ok"):
            break
        print(f"     attempt {attempt} failed: {str(result.get('error'))[:120]}", flush=True)
    if not result.get("ok"):
        return {"gen_id": gid, "ok": False, "error": result.get("error")}
    jobdir.mkdir(parents=True, exist_ok=True)
    if len(arr) > 1 and arr[1] and arr[1].get("url"):
        (jobdir / "video.mp4").write_bytes(c3._download(cli, tok, arr[1]["url"]))
    (jobdir / "request.json").write_text(json.dumps(req, indent=2))
    return {"gen_id": gid, "ok": True, "video": str(jobdir / "video.mp4")}


def cmd_rollout(args) -> int:
    c3.load_env()
    tok = os.environ.get("HF_TOKEN")
    if not tok:
        print("ERROR: HF_TOKEN missing (PRO token needed for the GPU job).")
        return 2
    seqs = [int(s) for s in args.seqs.split(",") if s.strip() != ""]
    variants = args.variants.split(",") if args.variants else VARIANTS
    RAW.mkdir(parents=True, exist_ok=True)
    gt = _gray(_read_frames(_gt_video_path()))
    actions_global = _bridge_actions_global()
    prompt = "A WidowX robot arm performs a tabletop manipulation task."
    manifest = []
    if args.append and (RAW / "manifest.json").exists():
        manifest = json.loads((RAW / "manifest.json").read_text())
        print(f"== appending to {len(manifest)} existing rollout(s) ==", flush=True)
    print(f"== world-model eval: {len(seqs)} sequence(s) x {len(variants)} policy variant(s) ==", flush=True)
    with httpx.Client(timeout=600) as cli:
        for si in seqs:
            print(f"\n-- sequence sample_index={si}", flush=True)
            # 1) zero probe first -> recover the true conditioning frame index d
            gid = f"wm-si{si}-zero"
            r = _gen(cli, tok, si, _variant_actions([[0.0] * 7] * ACTION_CHUNK, "zero"),
                     prompt, gid, RAW / gid)
            d = None
            if r.get("ok"):
                pred0 = _gray(_read_frames(Path(r["video"]))[0])
                d = _detect_cond_index(pred0, gt)
                print(f"   probe ok -> conditioning frame d={d}", flush=True)
            r.update({"sequence": si, "variant": "zero", "cond_index": d})
            manifest.append(r)
            if d is None:
                continue
            # real action chunk that actually starts at the conditioning frame
            real7 = actions_global[d:d + ACTION_CHUNK]
            if len(real7) < ACTION_CHUNK:  # near end of stream — clamp window back
                d = max(0, len(actions_global) - ACTION_CHUNK)
                real7 = actions_global[d:d + ACTION_CHUNK]
            # 2) real + remaining corrupted variants, same conditioning + seed
            for variant in [v for v in variants if v != "zero"]:
                gid = f"wm-si{si}-{variant}"
                acts = _variant_actions(real7, variant)
                rr = _gen(cli, tok, si, acts, prompt, gid, RAW / gid)
                rr.update({"sequence": si, "variant": variant, "cond_index": d})
                print(f"   {variant}: ok={rr.get('ok')}", flush=True)
                manifest.append(rr)
    (RAW / "manifest.json").write_text(json.dumps(manifest, indent=2))
    ok = sum(1 for m in manifest if m.get("ok"))
    print(f"\n== rollout DONE: {ok}/{len(manifest)} ok -> {RAW}/manifest.json ==", flush=True)
    return 0 if ok else 1


# --------------------------------------------------------------------------- #
# score (no GPU)
# --------------------------------------------------------------------------- #
def _corr(x: np.ndarray, y: np.ndarray) -> float:
    x = x - x.mean()
    y = y - y.mean()
    d = math.sqrt(float((x * x).sum()) * float((y * y).sum()))
    return float((x * y).sum() / d) if d > 0 else 0.0


def _score_one(pred_gray: np.ndarray, gt_gray: np.ndarray, d: int) -> dict:
    n = min(len(pred_gray), len(gt_gray) - d)
    ssim = [_ssim(pred_gray[t], gt_gray[d + t]) for t in range(n)]
    psnr = [_psnr(pred_gray[t], gt_gray[d + t]) for t in range(n)]
    # action-sensitivity: how much the clip moves vs its own first frame
    drift = [float(np.mean(np.abs(pred_gray[t] - pred_gray[0]))) for t in range(n)]
    pf = [float(np.mean(np.abs(pred_gray[t] - pred_gray[t - 1]))) for t in range(1, n)]

    # --- motion-aware metrics (confound-free: a static policy scores ~0) ---
    # signed change-maps relative to the conditioning frame
    pred_dyn = [pred_gray[t] - pred_gray[0] for t in range(n)]
    gt_dyn = [gt_gray[d + t] - gt_gray[d] for t in range(n)]
    if n > 1:
        pv = np.concatenate([p.ravel() for p in pred_dyn[1:]])
        gv = np.concatenate([g.ravel() for g in gt_dyn[1:]])
        motion_corr = _corr(pv, gv)
        # foreground = per-pixel weight where GT actually moves over the window;
        # SSIM map is averaged weighted by that mask (background excluded)
        win = 7
        off = win // 2
        gt_change = np.max(np.abs(np.stack(gt_dyn)), axis=0)
        mask = (gt_change > 12.0).astype(np.float32)
        mw = mask[off:off + (pred_gray.shape[1] - win + 1), off:off + (pred_gray.shape[2] - win + 1)]
        if mw.sum() > 0:
            mssim = []
            for t in range(n):
                sm = _ssim_map(pred_gray[t], gt_gray[d + t], win)
                mssim.append(float((sm * mw).sum() / mw.sum()))
            masked_ssim = float(np.mean(mssim[1:] or mssim))
        else:
            masked_ssim = float("nan")
    else:
        motion_corr, masked_ssim = 0.0, float("nan")

    return {
        "frames": n,
        "ssim_mean": round(float(np.mean(ssim[1:] or ssim)), 4),
        "psnr_mean": round(float(np.mean([p for p in psnr[1:] if math.isfinite(p)] or [0])), 2),
        "motion_corr": round(motion_corr, 4),
        "masked_ssim": None if math.isnan(masked_ssim) else round(masked_ssim, 4),
        "ssim_per_frame": [round(s, 4) for s in ssim],
        "final_drift": round(drift[-1], 3),
        "mean_interframe_motion": round(float(np.mean(pf or [0])), 3),
    }


def _strip(rows: list[tuple[str, np.ndarray]], idxs: list[int], out: Path) -> None:
    """Stack labelled rows of sampled RGB frames into one PNG via ffmpeg."""
    h, w = rows[0][1].shape[1:3]
    canvas = []
    for _, frames in rows:
        cells = [frames[min(i, len(frames) - 1)] for i in idxs]
        canvas.append(np.concatenate(cells, axis=1))
    img = np.concatenate(canvas, axis=0).astype(np.uint8)
    H, W = img.shape[:2]
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt",
                    "rgb24", "-s", f"{W}x{H}", "-i", "-", str(out)],
                   input=img.tobytes(), check=True)


def cmd_score(args) -> int:
    mpath = RAW / "manifest.json"
    if not mpath.exists():
        print(f"ERROR: no manifest at {mpath} — run `rollout` first.")
        return 2
    manifest = [m for m in json.loads(mpath.read_text()) if m.get("ok")]
    gt_rgb = _read_frames(_gt_video_path())
    gt = _gray(gt_rgb)
    by_seq: dict[int, dict] = {}
    rgb_cache: dict[str, np.ndarray] = {}
    for m in manifest:
        rgb = _read_frames(Path(m["video"]))
        rgb_cache[m["gen_id"]] = rgb
        sc = _score_one(_gray(rgb), gt, m["cond_index"])
        sc["variant"] = m["variant"]
        sc["gen_id"] = m["gen_id"]
        by_seq.setdefault(m["sequence"], {"cond_index": m["cond_index"], "variants": {}})
        by_seq[m["sequence"]]["variants"][m["variant"]] = sc

    report = {"space": SPACE, "num_steps": NUM_STEPS, "guidance": GUIDANCE,
              "metric": "luminance SSIM (uniform 7px window) + PSNR vs ground truth",
              "sequences": {}}
    n_seq = ranked_ok = 0
    n_seq_mc = mc_ok = 0
    for si, data in sorted(by_seq.items()):
        vs = data["variants"]
        order = [v["variant"] for v in sorted(vs.values(), key=lambda x: x["ssim_mean"], reverse=True)]
        real_best = bool(order and order[0] == "real")
        # motion-aware ranking (confound-free) — primary verdict metric
        mc_order = [v["variant"] for v in sorted(vs.values(), key=lambda x: x["motion_corr"], reverse=True)]
        real_best_mc = bool(mc_order and mc_order[0] == "real")
        # GT motion over the aligned window (sanity: is there real motion to predict?)
        d = data["cond_index"]
        gw = gt[d:d + max((v["frames"] for v in vs.values()), default=1)]
        gt_motion = round(float(np.mean(np.abs(np.diff(gw, axis=0)))), 3) if len(gw) > 1 else 0.0
        report["sequences"][str(si)] = {
            "cond_index": d, "gt_window_motion": gt_motion,
            "ranking_by_ssim": order, "real_is_best": real_best,
            "ranking_by_motion_corr": mc_order, "real_is_best_motion": real_best_mc,
            "variants": vs,
        }
        n_seq += 1
        ranked_ok += int(real_best)
        n_seq_mc += 1
        mc_ok += int(real_best_mc)
        # qualitative strip: GT vs real vs each corrupted (seq's own conditioning)
        idxs = [0, 4, 8, 12, 16]
        rows = [("GT", gt_rgb[d:d + 17])]
        for v in ["real", "scrambled", "reversed", "zero"]:
            if v in vs:
                rows.append((v, rgb_cache[vs[v]["gen_id"]]))
        try:
            _strip(rows, idxs, OUT / f"strip_si{si}.png")
        except Exception as e:
            print(f"   strip si{si} failed: {e}")

    report["summary"] = {
        "sequences": n_seq,
        "real_ranked_first_global_ssim": ranked_ok,
        "real_ranked_first_motion_corr": mc_ok,
        "discriminative_global_ssim": ranked_ok == n_seq and n_seq > 0,
        "discriminative_motion_corr": mc_ok == n_seq_mc and n_seq_mc > 0,
    }
    (OUT / "report.json").write_text(json.dumps(report, indent=2))
    _write_md(report)
    print(json.dumps(report["summary"], indent=2))
    print(f"-> {OUT}/report.json , {OUT}/REPORT.md , {OUT}/strip_si*.png")
    return 0


def _write_md(report: dict) -> None:
    L = ["# TASK-176 — Cosmos 3 world-model simulator: feasibility results", "",
         f"- Space: `{report['space']}`  | num_steps={report['num_steps']} guidance={report['guidance']}",
         f"- Metric: {report['metric']}",
         f"- Policy variants ranked per sequence by mean SSIM (frames>=1) vs the **real** recorded future.",
         "", "## Per-sequence ranking", "",
         "Two metrics: **global SSIM** (full-frame, confounded by static background) and "
         "**motion_corr** (correlation of predicted vs real change-maps — a do-nothing "
         "policy scores ~0, so it is the fair policy-ranking metric).", "",
         "| seq | cond frame | GT motion | global-SSIM ranking | real #1? | motion_corr ranking | real #1? |",
         "|----|----|----|----|----|----|----|"]
    for si, s in report["sequences"].items():
        L.append(f"| {si} | {s['cond_index']} | {s['gt_window_motion']} | "
                 f"{' > '.join(s['ranking_by_ssim'])} | {'✅' if s['real_is_best'] else '❌'} | "
                 f"{' > '.join(s['ranking_by_motion_corr'])} | {'✅' if s['real_is_best_motion'] else '❌'} |")
    L += ["", "## Per-variant metrics", "",
          "| seq | variant | global SSIM↑ | masked SSIM↑ | motion_corr↑ | PSNR↑ | interframe motion |",
          "|----|----|----|----|----|----|----|"]
    for si, s in report["sequences"].items():
        for v, m in s["variants"].items():
            L.append(f"| {si} | {v} | {m['ssim_mean']} | {m.get('masked_ssim')} | "
                     f"{m['motion_corr']} | {m['psnr_mean']} | {m['mean_interframe_motion']} |")
    su = report["summary"]
    L += ["", "## Summary", "",
          f"- Sequences: {su['sequences']}.",
          f"- real ranked #1 by **global SSIM** in {su['real_ranked_first_global_ssim']}/{su['sequences']} "
          f"(discriminative: {su['discriminative_global_ssim']}).",
          f"- real ranked #1 by **motion_corr** in {su['real_ranked_first_motion_corr']}/{su['sequences']} "
          f"(discriminative: {su['discriminative_motion_corr']}).",
          "", "See `report.json` for per-frame SSIM curves and `strip_si*.png` for "
          "qualitative GT-vs-prediction comparisons.", ""]
    (OUT / "REPORT.md").write_text("\n".join(L))


# --------------------------------------------------------------------------- #
# selftest (no GPU/network) — validate the metric math
# --------------------------------------------------------------------------- #
def cmd_selftest(args) -> int:
    rng = np.random.RandomState(0)
    # a structured (smooth) image — SSIM on it responds to noise like a real frame
    ramp = np.linspace(0, 255, 64, dtype=np.float32)
    a = np.tile(ramp, (64, 1))
    b = a.copy()
    noisy = np.clip(a + rng.normal(0, 25, a.shape), 0, 255).astype(np.float32)
    shifted = np.roll(a, 8, axis=1).astype(np.float32)
    checks = [
        ("SSIM(identical)==1", abs(_ssim(a, b) - 1.0) < 1e-6),
        ("PSNR(identical)==inf", math.isinf(_psnr(a, b))),
        ("SSIM(noisy)<0.9", _ssim(a, noisy) < 0.9),
        ("SSIM(identical)>SSIM(noisy)", _ssim(a, b) > _ssim(a, noisy)),
        ("SSIM(identical)>SSIM(shifted)", _ssim(a, b) > _ssim(a, shifted)),
        ("PSNR(noisy)<PSNR(identical)", _psnr(a, noisy) < _psnr(a, b)),
        ("detect_cond_index finds the match",
         _detect_cond_index(a, np.stack([shifted, noisy, a, b])) in (2, 3)),
    ]
    ok = all(p for _, p in checks)
    for name, p in checks:
        print(f"  [{'PASS' if p else 'FAIL'}] {name}")
    print("== selftest", "PASS ==" if ok else "FAIL ==")
    return 0 if ok else 1


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=str(HERE / "wm_out"))
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("rollout")
    r.add_argument("--seqs", default="0,6", help="comma-separated sample_index values")
    r.add_argument("--variants", default="", help=f"override (default: {','.join(VARIANTS)})")
    r.add_argument("--append", action="store_true", help="add to the existing manifest")
    r.set_defaults(func=cmd_rollout)
    s = sub.add_parser("score")
    s.set_defaults(func=cmd_score)
    t = sub.add_parser("selftest")
    t.set_defaults(func=cmd_selftest)
    args = ap.parse_args()

    global OUT, RAW, CACHE
    OUT = Path(args.out)
    RAW = OUT / "raw"
    CACHE = OUT / "space_src"
    OUT.mkdir(parents=True, exist_ok=True)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())

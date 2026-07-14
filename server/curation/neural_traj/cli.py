"""CLI for the neural-trajectory generator (TASK-182).

Mirrors the ``cosmos3_synth.py`` CLI contract so CosmosSyntheticService can
spawn either generator uniformly:

  python -m neural_traj --out OUT [--backend {mock,wsl}] generate --episodes N [--prompt S] [--seed K]
  python -m neural_traj --out OUT [--backend {mock,wsl}] convert

stdout progress lines are parsed by the service — keep the format:
  ``-- neural-traj-<i> ...``   episode start
  ``... ok=True ...``          episode success
  ``== generate DONE: x/y``    generation summary
  ``== convert DONE ...``      conversion summary
"""
from __future__ import annotations

import argparse
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path

from .backends import get_backend
from .constants import DEFAULT_PROMPTS
from .convert import convert_dataset
from .errors import NeuralTrajError


def _plan(episodes: int, prompt: str | None, seed: int) -> list[dict]:
    """Build the per-episode specs: cycled default prompts unless overridden."""
    plan = []
    for i in range(episodes):
        plan.append(
            {
                "gen_id": f"neural-traj-{i:02d}",
                "prompt": (
                    prompt.strip()
                    if prompt and prompt.strip()
                    else DEFAULT_PROMPTS[i % len(DEFAULT_PROMPTS)]
                ),
                "seed": seed + i,
            }
        )
    return plan


def cmd_generate(args: argparse.Namespace) -> int:
    backend = get_backend(args.backend)
    raw_dir = Path(args.out) / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)
    plan = _plan(args.episodes, args.prompt, args.seed)
    print(
        f"== generating {len(plan)} neural-trajectory episode(s) "
        f"via backend={backend.name} model={backend.model} ==",
        flush=True,
    )

    manifest: list[dict] = []
    for spec in plan:
        gid = spec["gen_id"]
        jobdir = raw_dir / gid
        jobdir.mkdir(parents=True, exist_ok=True)
        print(f"\n-- {gid}: {spec['prompt']} (seed={spec['seed']})", flush=True)
        t0 = time.monotonic()
        try:
            result = backend.generate_episode(spec, jobdir)
        except NeuralTrajError as e:
            # Backend-level unavailability (e.g. wsl stub): abort the whole run
            # with a clean message rather than failing N times identically.
            print(f"ERROR: {e}", flush=True)
            return 2
        except Exception as e:  # isolate per-episode failures
            dt = time.monotonic() - t0
            print(f"   {dt:.1f}s ok=False error={type(e).__name__}: {e}", flush=True)
            manifest.append({"gen_id": gid, "ok": False, "error": f"{type(e).__name__}: {e}"})
            continue
        dt = time.monotonic() - t0
        (jobdir / "request.json").write_text(json.dumps({**spec, "backend": backend.name}, indent=2))
        (jobdir / "result.json").write_text(json.dumps({"ok": True, **result}, indent=2))
        manifest.append(
            {
                "gen_id": gid,
                "ok": True,
                "latency_s": round(dt, 1),
                "prompt": spec["prompt"],
                "seed": spec["seed"],
                "nframes": result["nframes"],
                "width": result["width"],
                "height": result["height"],
                "video": str(jobdir / "video.mp4"),
            }
        )
        print(f"   {dt:.1f}s ok=True frames={result['nframes']}", flush=True)

    (raw_dir / "manifest.json").write_text(json.dumps(manifest, indent=2))
    provenance = {
        "backend": backend.name,
        "model": backend.model,
        "seed": args.seed,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "episodes": {m["gen_id"]: m.get("prompt") for m in manifest if m.get("ok")},
    }
    (raw_dir / "provenance.json").write_text(json.dumps(provenance, indent=2))
    ok_n = sum(1 for m in manifest if m.get("ok"))
    print(f"\n== generate DONE: {ok_n}/{len(plan)} succeeded -> {raw_dir}/manifest.json ==", flush=True)
    return 0 if ok_n else 1


def cmd_convert(args: argparse.Namespace) -> int:
    return convert_dataset(Path(args.out))


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        prog="neural_traj",
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument(
        "--out",
        default="./neural_traj_out",
        help="Output root (raw episodes + exported dataset). Default: ./neural_traj_out",
    )
    ap.add_argument(
        "--backend",
        choices=["mock", "wsl"],
        default=os.environ.get("NEURAL_TRAJ_BACKEND", "mock"),
        help="Generation backend (default: env NEURAL_TRAJ_BACKEND or 'mock').",
    )
    sub = ap.add_subparsers(dest="cmd", required=True)
    g = sub.add_parser("generate")
    g.add_argument("--episodes", type=int, default=3)
    g.add_argument("--prompt", default=None, help="Override the cycled task prompts for all episodes.")
    g.add_argument("--seed", type=int, default=0, help="Base seed (episode i uses seed+i).")
    g.set_defaults(func=cmd_generate)
    c = sub.add_parser("convert")
    c.set_defaults(func=cmd_convert)
    args = ap.parse_args(argv)
    try:
        return args.func(args)
    except NeuralTrajError as e:
        print(f"ERROR: {e}", flush=True)
        return 2

#!/usr/bin/env python3
"""Render stills from every camera in a scene, with no DDS and no robot control.

Why this exists
---------------
`sim_main.py` builds the scene and drives the robot, but it never writes a camera
frame to disk -- its cameras go to a ZMQ image server for teleop. `isaac_capture.py`
renders beautifully and is the wrong tool here: it builds its OWN warehouse and
glides a kinematic robot through it, so it cannot show THIS scene at all.

So this loads the task cfg, lets the physics settle, and dumps every camera the
scene registers. It takes no DDS domain and answers no RPCs, which is what makes
it safe to run while thinking about something else.

    python capture_factory_stills.py --out /tmp/shots --headless --enable_cameras

Run it from the checkout root, or set UNITREE_SIM_DIR to it: the scene modules
resolve their USD props against PROJECT_ROOT, which only `sim_main.py` sets.

One warning inherited from the checkout: `sim_main.py`'s exit handler SIGTERMs
every other `sim_main.py`. This file is deliberately not named that, so it neither
kills nor is killed by one -- but only ever run ONE Isaac process at a time
regardless, and wait for `nvidia-smi` to fall back to its ~111 MiB baseline
between launches.

@status tool -- run by hand; needs a GPU and Isaac Lab, so it is not in any suite.
"""
from __future__ import annotations

import argparse
import os
import sys

# Must happen BEFORE anything under `tasks/` is imported. Every scene module in the
# checkout resolves its USD props against `os.environ["PROJECT_ROOT"]`, and
# `sim_main.py:7-8` is the only thing that sets it -- so a tool that is not
# `sim_main.py` gets `None/assets/objects/.../PackingTable.usd` and a
# FileNotFoundError that reads like a missing asset rather than a missing env var.
# Derived exactly as sim_main.py derives it: this file sits in the checkout root.
_PROJECT_ROOT = os.environ.get("UNITREE_SIM_DIR") or os.path.dirname(
    os.path.abspath(__file__))
os.environ.setdefault("PROJECT_ROOT", _PROJECT_ROOT)
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)

from isaaclab.app import AppLauncher

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--task", default="Isaac-Factory-PauseRoom-G129-Dex3-Wholebody")
parser.add_argument("--out", required=True, help="output directory for the PNGs")
parser.add_argument("--settle", type=int, default=90,
                    help="physics steps before capturing. The G1 is dropped into the "
                         "scene at reset and needs a moment to load its feet; capturing "
                         "at step 0 shows it hanging in a T-pose above the floor.")
parser.add_argument("--only", default="",
                    help="comma-separated camera names; default is every camera found")
parser.add_argument("--light-scale", type=float, default=1.0,
                    help="multiply every light's intensity. The scene is lit for a "
                         "roofless hall of white surfaces, which renders flat and "
                         "blown out; 0.3-0.5 restores the shadows that make the "
                         "columns and the table legible.")
parser.add_argument("--shot", action="append", default=[], metavar="NAME:EX,EY,EZ:TX,TY,TZ",
                    help="render an extra framing by MOVING an existing camera to eye "
                         "EX,EY,EZ looking at TX,TY,TZ, saved as NAME.png. Repeatable. "
                         "This re-aims a camera rather than spawning one, because "
                         "sensors cannot be added after the scene is built.")
parser.add_argument("--shot-camera", default="",
                    help="which camera --shot re-aims (default: the widest overview "
                         "camera found). Its own framing is still captured first.")
AppLauncher.add_app_launcher_args(parser)
args = parser.parse_args()

app_launcher = AppLauncher(args)
simulation_app = app_launcher.app

# Everything below must be imported AFTER the app exists -- Isaac Lab's extensions
# are not on the path until AppLauncher has run.
import gymnasium as gym  # noqa: E402
import numpy as np  # noqa: E402

import tasks  # noqa: E402,F401  (registers the gym ids, including ours)
from isaaclab_tasks.utils.parse_cfg import parse_env_cfg  # noqa: E402


def _save_png(path: str, rgb: np.ndarray) -> None:
    """Write RGB uint8 (H, W, 3). PIL ships with Isaac Sim; PPM is the fallback."""
    if rgb.shape[-1] == 4:          # RGBA -> drop alpha, it is opaque here
        rgb = rgb[..., :3]
    rgb = np.ascontiguousarray(rgb.astype(np.uint8))
    try:
        from PIL import Image
        Image.fromarray(rgb).save(path)
    except Exception:               # noqa: BLE001
        ppm = os.path.splitext(path)[0] + ".ppm"
        with open(ppm, "wb") as fh:
            fh.write(b"P6\n%d %d\n255\n" % (rgb.shape[1], rgb.shape[0]))
            fh.write(rgb.tobytes())
        print(f"  (no PIL — wrote {ppm})", flush=True)


def _scale_lights(scale: float) -> None:
    """Multiply the intensity of every light on the stage.

    Done on the USD stage rather than through the cfg because by this point the
    scene is built; the cfg is no longer what the renderer is reading.
    """
    from pxr import Usd, UsdLux

    # `isaacsim.core.utils.stage` does not exist in every Isaac Lab build (it is
    # absent in the 3.0 the checkout pins), and the USD context always does.
    stage = None
    try:
        import omni.usd
        stage = omni.usd.get_context().get_stage()
    except Exception:  # noqa: BLE001
        try:
            import isaacsim.core.utils.stage as stage_utils
            stage = stage_utils.get_current_stage()
        except Exception:  # noqa: BLE001
            pass
    if stage is None:
        print("  cannot reach the USD stage — leaving lights alone", file=sys.stderr)
        return
    touched = 0
    for prim in Usd.PrimRange(stage.GetPseudoRoot()):
        light = UsdLux.LightAPI(prim)
        if not light:
            continue
        attr = light.GetIntensityAttr()
        if not attr:
            continue
        before = attr.Get()
        if before is None:
            continue
        attr.Set(float(before) * scale)
        touched += 1
        print(f"  light {prim.GetPath()}: {before:g} -> {float(before) * scale:g}",
              flush=True)
    print(f"scaled {touched} light(s) by {scale:g}", flush=True)


def _parse_shot(spec: str):
    name, eye, target = spec.split(":", 2)
    to3 = lambda t: tuple(float(v) for v in t.split(","))  # noqa: E731
    return name, to3(eye), to3(target)


def _render_shots(env, dt: float, cameras: dict) -> int:
    """Re-aim one camera at each requested eye/target and save the frame."""
    if not args.shot:
        return 0
    name = args.shot_camera or (
        "world_camera" if "world_camera" in cameras else sorted(cameras)[0])
    cam = cameras.get(name)
    if cam is None:
        print(f"--shot-camera {name!r} is not one of {sorted(cameras)}", file=sys.stderr)
        return 0

    import torch

    written = 0
    for spec in args.shot:
        try:
            shot_name, eye, target = _parse_shot(spec)
        except ValueError:
            print(f"bad --shot {spec!r}, want NAME:EX,EY,EZ:TX,TY,TZ", file=sys.stderr)
            continue
        dev = cam.device
        cam.set_world_poses_from_view(
            torch.tensor([eye], dtype=torch.float32, device=dev),
            torch.tensor([target], dtype=torch.float32, device=dev))
        # Two steps: one to apply the pose, one to render from it.
        for _ in range(2):
            env.sim.step()
            env.scene.update(dt)
        rgb = cam.data.output["rgb"]
        arr = rgb[0].detach().cpu().numpy() if hasattr(rgb, "detach") else np.asarray(rgb[0])
        path = os.path.join(args.out, f"{shot_name}.png")
        _save_png(path, arr)
        print(f"  {shot_name:24s} eye={eye} -> {path}", flush=True)
        written += 1
    return written


def main() -> int:
    os.makedirs(args.out, exist_ok=True)

    env_cfg = parse_env_cfg(args.task, device=args.device, num_envs=1)
    env_cfg.env_name = args.task
    env = gym.make(args.task, cfg=env_cfg).unwrapped
    env.reset()

    # These tasks run in `use_rl_action_mode`, so `env.step()` is never called by
    # the vendor either. Step the simulation directly and refresh the scene so the
    # sensors re-render; going through step() would demand an action tensor this
    # tool has no business inventing.
    dt = env.sim.get_physics_dt()
    for _ in range(args.settle):
        env.sim.step()
        env.scene.update(dt)

    if args.light_scale != 1.0:
        _scale_lights(args.light_scale)
        # Lights change the rendered image, not the physics, but the sensors only
        # pick it up on the next render pass.
        for _ in range(3):
            env.sim.step()
            env.scene.update(dt)

    wanted = [n.strip() for n in args.only.split(",") if n.strip()]
    cameras = {}
    for name, sensor in env.scene.sensors.items():
        if hasattr(sensor, "data") and getattr(sensor.data, "output", None) is not None:
            if "rgb" in sensor.data.output:
                cameras[name] = sensor

    if not cameras:
        print("no cameras with an 'rgb' output in this scene", file=sys.stderr)
        return 1

    print(f"cameras found: {', '.join(sorted(cameras))}", flush=True)
    written = 0
    for name, cam in sorted(cameras.items()):
        if wanted and name not in wanted:
            continue
        rgb = cam.data.output["rgb"]
        arr = rgb[0].detach().cpu().numpy() if hasattr(rgb, "detach") else np.asarray(rgb[0])
        path = os.path.join(args.out, f"{name}.png")
        _save_png(path, arr)
        print(f"  {name:24s} {arr.shape} -> {path}", flush=True)
        written += 1

    written += _render_shots(env, dt, cameras)

    print(f"\nwrote {written} image(s) to {args.out}", flush=True)
    env.close()
    return 0


if __name__ == "__main__":
    code = main()
    simulation_app.close()
    sys.exit(code)

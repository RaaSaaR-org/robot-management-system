#!/usr/bin/env python3
"""Gait-induced vertical bob: detect it, measure it, and prove its absence.

NeoDEM, TASK-203 step 5. The step asks for "head-camera frames [that] show
gait-induced bob absent from the kinematic base". A pair of videos cannot
settle that -- bob is a few centimetres and the eye is a poor instrument -- so
this measures it instead, and measures the control alongside it.

The claim has two halves and BOTH need evidence:

  * under the real locomotion policy the head oscillates vertically at the
    step frequency (the G1 steps at ~1.7 Hz, so bob appears at ~1.7 Hz or its
    first harmonic ~3.4 Hz, depending on whether the two legs load the torso
    symmetrically);
  * under `isaac_capture.py`'s kinematic glide -- fixed joint pose, base
    translated by integrating a velocity -- there is NO such oscillation,
    because nothing in that pipeline can produce one.

The second half is what makes the first half mean anything. A vertical wobble
of a few mm shows up in almost any trace if you squint; the glide run is the
negative control that says the detector is not simply reporting noise.

USAGE

    # measure one run
    isaac_bob_report.py --walk walk.log

    # measure a run against its kinematic control (the real test)
    isaac_bob_report.py --walk walk.log --glide glide.log

    # verify the detector itself, no sim needed, ~1 s
    isaac_bob_report.py --selftest

SAMPLING RATE IS NOT OPTIONAL. A ~1.7 Hz oscillation needs well above 3.4 Hz of
sampling to resolve, and the sim's default instrumentation interval
(NEODEM_LOG_EVERY=25) is 2 Hz of simulated time -- BELOW Nyquist for the very
signal being measured. It will report a confident, wrong, low frequency. Set
NEODEM_LOG_EVERY=5 (10 Hz) or lower when capturing. This tool refuses to report
a frequency below MIN_SAMPLE_HZ rather than emit an aliased number; that guard
exists because an earlier NeoDEM report tool did exactly this and reported a
0.27 Hz "cadence" for a 1.72 Hz gait.
"""
import argparse
import math
import re
import sys

import numpy as np


# Policy rate: decimation 4 x sim.dt 0.005 -> 50 Hz of simulated time.
POLICY_HZ = 50.0

# Below this, a ~1.7 Hz gait cannot be resolved and any peak is an artefact.
# 8 Hz leaves >2x margin over the 3.4 Hz Nyquist floor for the first harmonic.
MIN_SAMPLE_HZ = 8.0

# Where a humanoid's bob can physically live. Below 0.5 Hz is postural drift,
# above 6 Hz is faster than any G1 gait harmonic worth crediting.
BAND_LO_HZ = 0.5
BAND_HI_HZ = 6.0

# A glide has no oscillator at all, so anything it shows is numerical noise.
# Require the walk to beat the glide by this factor before calling it bob.
MIN_BOB_RATIO = 3.0

# Below this the "oscillation" is not a gait, it is quantisation.
MIN_BOB_MM = 1.0


# The `[TASK-223]` line carries z; the `[TASK-203]` line carries xy and contact.
# Both are accepted so a single capture can serve this tool and isaac_gait_report.
Z223 = re.compile(r"\[TASK-223\]\s+step=\s*(\d+).*?\bz=([-+0-9.]+)")
XYZ203 = re.compile(r"\[TASK-203\]\s+step=\s*(\d+).*?\bhead_z=([-+0-9.]+)")
BASE203 = re.compile(r"\[TASK-203\]\s+step=\s*(\d+).*?\bbase_z=([-+0-9.]+)")


def parse_series(path, which="auto"):
    """Pull (step, z) out of a sim log. Returns (steps, z, label)."""
    text = open(path, encoding="utf-8", errors="replace").read()
    for label, rx in (("head_z", XYZ203), ("base_z", BASE203), ("z", Z223)):
        if which not in ("auto", label):
            continue
        hits = rx.findall(text)
        if len(hits) >= 16:
            steps = np.array([int(a) for a, _ in hits], dtype=float)
            z = np.array([float(b) for _, b in hits], dtype=float)
            return steps, z, label
    raise SystemExit(
        f"{path}: no usable vertical series found "
        f"(looked for head_z=, base_z=, z= on [TASK-203]/[TASK-223] lines; "
        f"need at least 16 samples)")


# isaac_capture.py's kinematic glide: head_z = HEAD_OFFSET_Z + (height - NEUTRAL)
# (isaac_capture.py:1105, constants at :128 and :191). Old telemetry.json files
# predate the head_z field, but `height` is logged per frame and head_z is a pure
# function of it, so the control can be reconstructed from any existing capture
# rather than costing a GPU slot to re-shoot.
GLIDE_HEAD_OFFSET_Z = 1.271
GLIDE_NEUTRAL_STAND_HEIGHT = 0.75


def parse_glide_telemetry(path):
    """(steps, z, label) from an isaac_capture.py telemetry.json.

    Prefers a logged head_z; falls back to reconstructing it from `height`.
    Returns steps on the same 50 Hz simulated-step scale the sim logs use, so
    one analyser serves both sources.
    """
    import json
    d = json.load(open(path, encoding="utf-8"))
    meta = d.get("meta", [])
    if len(meta) < 16:
        raise SystemExit(f"{path}: only {len(meta)} frames")
    fps = float(d.get("fps") or 0.0) or 24.0
    if "head_z" in meta[0]:
        z = np.array([float(r["head_z"]) for r in meta])
        label = "head_z (logged)"
    else:
        z = np.array([GLIDE_HEAD_OFFSET_Z + (float(r["height"]) - GLIDE_NEUTRAL_STAND_HEIGHT)
                      for r in meta])
        label = "head_z (reconstructed from height)"
    steps = np.arange(len(z), dtype=float) * (POLICY_HZ / fps)
    return steps, z, label


def sample_hz(steps):
    """Sampling rate in Hz of simulated time, from the MODE of step deltas.

    The mode, not the min: the instrumentation logs every step for the first
    few steps before settling into its interval, so `min` reports 50 Hz for
    any capture and silently disarms the aliasing guard below. That exact bug
    shipped once in isaac_gait_report.py.
    """
    d = np.diff(steps)
    d = d[d > 0]
    if d.size == 0:
        return 0.0
    vals, counts = np.unique(d, return_counts=True)
    return POLICY_HZ / float(vals[int(np.argmax(counts))])


def analyse(steps, z, fs):
    """Dominant in-band oscillation of `z`. Returns a dict of measurements.

    Detrends linearly first: a robot walking forward on a slight slope, or one
    whose base height sags as the policy settles, carries a ramp that would
    otherwise dominate the low-frequency bins and drag the peak search down.
    """
    n = len(z)
    if n < 16:
        return {"ok": False, "why": f"only {n} samples"}

    # Resample onto a uniform grid: the logger emits on a fixed step interval,
    # but a dropped line would otherwise shift every later sample in time.
    grid = np.arange(steps[0], steps[-1] + 1e-9, POLICY_HZ / fs)
    zi = np.interp(grid, steps, z)
    zi = zi - np.polyval(np.polyfit(np.arange(len(zi)), zi, 1), np.arange(len(zi)))

    spec = np.fft.rfft(zi)
    freqs = np.fft.rfftfreq(len(zi), d=1.0 / fs)
    band = (freqs >= BAND_LO_HZ) & (freqs <= BAND_HI_HZ)
    if not band.any():
        return {"ok": False, "why": f"no FFT bin inside {BAND_LO_HZ}-{BAND_HI_HZ} Hz"}

    mag = np.abs(spec)
    k = int(np.argmax(np.where(band, mag, -np.inf)))
    peak_hz = float(freqs[k])

    # Reconstruct just the peak and its immediate neighbours, then report
    # peak-to-peak of that. Peak-to-peak of a band-limited reconstruction is
    # directly interpretable ("the head moves N mm up and down"), where a raw
    # FFT magnitude depends on window and length.
    keep = np.zeros_like(spec)
    lo, hi = max(0, k - 1), min(len(spec), k + 2)
    keep[lo:hi] = spec[lo:hi]
    recon = np.fft.irfft(keep, n=len(zi))
    p2p_mm = float(recon.max() - recon.min()) * 1000.0

    in_band = float(np.sum(mag[band] ** 2))
    total = float(np.sum(mag[1:] ** 2)) or 1.0
    return {"ok": True, "peak_hz": peak_hz, "p2p_mm": p2p_mm,
            "band_frac": in_band / total, "n": len(zi),
            "span_s": len(zi) / fs, "raw_p2p_mm": float(z.max() - z.min()) * 1000.0}


def report(name, path, which="auto"):
    if path.endswith(".json"):
        steps, z, label = parse_glide_telemetry(path)
    else:
        steps, z, label = parse_series(path, which)
    fs = sample_hz(steps)
    print(f"\n=== {name}: {path}")
    print(f"  series          {label}, {len(steps)} samples, "
          f"steps {int(steps[0])}..{int(steps[-1])}")
    print(f"  sampling        {fs:.1f} Hz of simulated time")
    if fs < MIN_SAMPLE_HZ:
        print(f"  ** ALIASED: {fs:.1f} Hz cannot resolve a ~1.7 Hz gait (needs "
              f">= {MIN_SAMPLE_HZ:.0f} Hz). Re-capture with NEODEM_LOG_EVERY=5.")
        print("  ** Refusing to report a frequency from this trace.")
        return None
    r = analyse(steps, z, fs)
    if not r["ok"]:
        print(f"  ** cannot analyse: {r['why']}")
        return None
    print(f"  window          {r['span_s']:.1f} s ({r['n']} resampled points)")
    print(f"  raw excursion   {r['raw_p2p_mm']:.1f} mm peak-to-peak (undetrended)")
    print(f"  dominant        {r['peak_hz']:.2f} Hz")
    print(f"  amplitude       {r['p2p_mm']:.1f} mm peak-to-peak at that frequency")
    print(f"  in-band power   {100.0*r['band_frac']:.1f}% of total")
    return r


def verdict(walk, glide):
    print("\n=== VERDICT")
    if walk is None:
        print("  INCONCLUSIVE: the walking trace could not be analysed.")
        return 1
    if glide is None:
        print(f"  Walking head bob: {walk['p2p_mm']:.1f} mm at {walk['peak_hz']:.2f} Hz.")
        print("  NO KINEMATIC CONTROL SUPPLIED -- this is a measurement, not yet a")
        print("  result. Without the glide run there is nothing to say the detector")
        print("  is not just reporting noise. Re-run with --glide.")
        return 0
    ratio = walk["p2p_mm"] / max(glide["p2p_mm"], 1e-6)
    print(f"  walk   {walk['p2p_mm']:6.1f} mm p-p at {walk['peak_hz']:.2f} Hz")
    print(f"  glide  {glide['p2p_mm']:6.1f} mm p-p at {glide['peak_hz']:.2f} Hz")
    print(f"  ratio  {ratio:6.1f}x")
    if walk["p2p_mm"] < MIN_BOB_MM:
        print(f"  FAIL: the walking bob is under {MIN_BOB_MM} mm -- that is "
              f"quantisation, not a gait.")
        return 1
    if ratio < MIN_BOB_RATIO:
        print(f"  FAIL: the walk exceeds the glide by only {ratio:.1f}x "
              f"(need {MIN_BOB_RATIO}x). The kinematic base shows a comparable "
              f"wobble, so this does not demonstrate gait-induced bob.")
        return 1
    print(f"  PASS: the walking base/head oscillates {walk['p2p_mm']:.1f} mm at "
          f"{walk['peak_hz']:.2f} Hz, {ratio:.0f}x the kinematic control's "
          f"{glide['p2p_mm']:.1f} mm. TASK-203 step 5's claim holds.")
    return 0


def selftest():
    """Verify the detector on synthetic traces, with no sim and no GPU.

    The cases that matter are the ones where a naive detector goes wrong: a
    flat trace with drift (must NOT report bob), and an undersampled walk
    (must REFUSE rather than report the aliased frequency).
    """
    fails = []

    def check(ok, label, detail=""):
        print(f"    {'PASS' if ok else 'FAIL'}  {label}" + (f"  [{detail}]" if detail else ""))
        if not ok:
            fails.append(label)

    fs, secs = 10.0, 30.0
    t = np.arange(0, secs, 1.0 / fs)
    steps = t * POLICY_HZ
    rng = np.random.default_rng(0)

    print("(1) a 1.70 Hz, 30 mm bob is found at the right frequency and amplitude")
    walk = 0.75 + 0.015 * np.sin(2 * math.pi * 1.70 * t) + rng.normal(0, 0.0005, t.size)
    r = analyse(steps, walk, fs)
    check(abs(r["peak_hz"] - 1.70) < 0.15, "frequency within 0.15 Hz", f"{r['peak_hz']:.2f} Hz")
    check(abs(r["p2p_mm"] - 30.0) < 6.0, "amplitude within 6 mm of 30", f"{r['p2p_mm']:.1f} mm")

    print("\n(2) a kinematic glide -- flat, drifting, noisy -- shows no bob")
    glide = 0.75 + 0.002 * t + rng.normal(0, 0.0005, t.size)   # 2 mm/s sag, no oscillator
    g = analyse(steps, glide, fs)
    check(g["p2p_mm"] < MIN_BOB_MM, "glide bob is under the 1 mm floor", f"{g['p2p_mm']:.2f} mm")
    check(r["p2p_mm"] / max(g["p2p_mm"], 1e-6) > MIN_BOB_RATIO,
          "walk beats glide by more than 3x",
          f"{r['p2p_mm']/max(g['p2p_mm'],1e-6):.0f}x")
    check(verdict(r, g) == 0, "verdict() passes a real bob against a flat control")
    check(verdict(g, g) == 1, "verdict() REJECTS a glide compared against itself")

    print("\n(3) linear drift alone is never mistaken for bob")
    ramp = 0.75 - 0.01 * t                      # 10 mm/s sag, monotonic
    d = analyse(steps, ramp, fs)
    check(d["p2p_mm"] < MIN_BOB_MM, "a pure ramp detrends to nothing",
          f"{d['p2p_mm']:.3f} mm")

    print("\n(4) undersampling is refused, not silently aliased")
    fs_bad = 2.0                                 # the sim's DEFAULT logging interval
    t2 = np.arange(0, secs, 1.0 / fs_bad)
    steps2 = t2 * POLICY_HZ
    walk2 = 0.75 + 0.015 * np.sin(2 * math.pi * 1.70 * t2)
    check(sample_hz(steps2) < MIN_SAMPLE_HZ,
          "2 Hz sampling is recognised as below the guard",
          f"{sample_hz(steps2):.1f} Hz")
    aliased = analyse(steps2, walk2, fs_bad)
    check(abs(aliased["peak_hz"] - 1.70) > 0.3,
          "and it WOULD have reported a wrong frequency -- guard is load-bearing",
          f"{aliased['peak_hz']:.2f} Hz vs true 1.70")

    print("\n(5) the step-delta mode survives a burst of every-step logging")
    mixed = np.concatenate([np.arange(0, 6), np.arange(10, 1000, 5)]).astype(float)
    check(abs(sample_hz(mixed) - 10.0) < 1e-6,
          "mode ignores the leading every-step burst", f"{sample_hz(mixed):.1f} Hz")

    print()
    if fails:
        print(f"FAILED: {len(fails)} check(s): {fails}")
        return 1
    print("all bob-detector self-checks passed")
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--walk", help="sim log from a run under the locomotion policy")
    ap.add_argument("--glide", help="kinematic-glide control: either a sim log, or an "
                                    "isaac_capture.py telemetry.json (detected by suffix)")
    ap.add_argument("--series", default="auto", choices=["auto", "head_z", "base_z", "z"])
    ap.add_argument("--selftest", action="store_true",
                    help="verify the detector on synthetic traces; no sim needed")
    a = ap.parse_args()

    if a.selftest:
        return selftest()
    if not a.walk:
        ap.error("need --walk (or --selftest)")
    w = report("WALK  (locomotion policy)", a.walk, a.series)
    g = report("GLIDE (kinematic control)", a.glide, a.series) if a.glide else None
    return verdict(w, g)


if __name__ == "__main__":
    sys.exit(main())

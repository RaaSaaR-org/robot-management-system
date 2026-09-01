#!/usr/bin/env python3
"""Measure the ego-view luminance of recorded frames, and say whether it matches training.

WHY THIS EXISTS
---------------
The head camera is the VLA policy's `ego_view` and it is the policy's only visual input.
The Isaac factory pause-room scene renders it far brighter than the MuJoCo scene the
manipulation policy was trained on. That is a large domain shift on the one input the
policy has, and it is invisible in a thumbnail: both scenes look like a grey room with a
table in it. This tool is what turns "the Isaac renders look washed out" into a number, and
it is what the one available GPU session should use to judge whether the fix landed.

It needs no GPU, no Isaac and no network. It reads JPEG/PNG frames off disk.

MEASURE A REGION, NOT A FRAME.  READ THIS BEFORE QUOTING A NUMBER.
------------------------------------------------------------------
A median over a whole frame is a statement about that frame's CONTENT, not about its light.
The MuJoCo training frames are a tabletop close-up that is ~90 % cloth. The Isaac frames at
the table also carry walls, a floor, a plate and two black hands. The Isaac frames "walking
the hall" contain no tabletop at all. Comparing whole-frame medians across those is
comparing a table to a wall, and the first version of this tool did exactly that: it
reported the Isaac ego view as 7.18x too bright and concluded that "the hall is a separate,
hotter viewpoint". Both were artefacts. On a matched region -- one surface, present in both
scenes, and nothing else inside the rectangle -- the answer is 8.33x, and the hall does not
enter into it because it has no matched region to offer.

The same trap voids whole-frame p90/p10 as a measure of shadow depth. Whole-frame, the
MuJoCo frames span 10.24x and the Isaac frames at the table 1.66x, which reads as "the Isaac
scene is six times flatter". It is not: the MuJoCo p90 is the white plate and the Isaac p10
is the black hands. On the matched tabletop the two spreads are 1.29x and 1.23x.

So: pass `--roi`. Without it the tool measures whole frames, prints the numbers, and warns
that they are not a lighting comparison. With it, it measures only what you name.

    /home/humanoid/anaconda3/envs/unitree_sim_env6/bin/python measure_scene_exposure.py \\
        --reference /home/humanoid/factory-mission-logs/groot/ab_on/ep_seed0 \\
        --reference-roi 120,60,620,250 \\
        --roi 60,175,580,235 --roi 80,240,200,330 --roi 490,240,570,330 \\
        /home/humanoid/factory-mission-logs/grasp3-002355/grasp_frames

Those are the rectangles the factory scene's lighting is calibrated from, on 640x480 frames,
x0,y0,x1,y1, half-open, and they are recorded in `MEASURED_TABLETOP` in
`common_scene/factory_pauseroom_layout.py`. The MuJoCo rectangle is cloth above the apple
and the plate, avoiding the arm shadow at the left edge; the three Isaac rectangles are
tabletop above and to either side of the hands. Both were checked by drawing them on the
frames. A different defensible pair of rectangles gives 4.26x where these give 3.95x for the
light cut -- 0.11 stops -- so quote "about 4x" and not a third digit.

WHAT IT MEASURES, AND WHAT THE NUMBERS MEAN
-------------------------------------------
Luminance per pixel is 0.2126R + 0.7152G + 0.0722B on sRGB values in [0, 1] -- Rec. 709
weights on the ENCODED values, which is what "how bright does this look" means.

The verdict is computed in SCENE-LINEAR light, because exposure error is multiplicative in
linear light and sRGB values are not proportional to light. This matters more than it
sounds: the encoded tabletop medians 0.8667 and 0.3261 differ by 2.7x, and the light behind
them differs by 8.3x. A fix sized from the encoded ratio would be three times too small.

Two things that ratio is NOT:

  * it is not an exposure error on its own. It is rendered light against rendered light, and
    two scenes can differ in rendered light because their lights differ OR because their
    surfaces do. In the case it was built for, both were true: the Isaac tabletop was also
    painted 2.11x too light. Pass `--albedo` / `--reference-albedo` (the Rec. 709 luminance
    of each side's diffuse colour) and the tool divides them out and reports the LIGHTING
    ratio separately. Without them it reports the rendered ratio and says so.
  * it is not exact. Isaac runs an ACES-approximation tonemapper whose implementation is
    compiled into the RTX plugin and cannot be inverted here. Substituting the standard
    Narkowicz approximation on the Isaac side only moves the 8.33x to 8.23x -- 1 % -- so the
    figure is reproducible and close, but it is an approximation and not a bound. (Inverting
    an ACES curve on BOTH sides, which is what an earlier version of this docstring did by
    implication, is wrong twice: MuJoCo has no tonemapper.)

The tool also prints the scene-linear p90/p10 spread. Inside a single-surface ROI that is a
real measure of how much shading variation the surface carries; over a whole frame it is
mostly albedo contrast. It is reported and never judged, because a scene can land in the
band and still be flat.

HOW THE FIGURES IN THE SCENE'S LIGHTING COMMENT WERE OBTAINED
-------------------------------------------------------------
The command above, with the defaults (`--limit 12 --sample first`), against these
directories on this box:

    MuJoCo, the training look   /home/humanoid/factory-mission-logs/groot/ab_on/ep_seed0/
    Isaac, at the table         /home/humanoid/factory-mission-logs/grasp3-002355/grasp_frames/

    region                                    median     p10     p90   linear p90/p10
    MuJoCo cloth                              0.3261  0.3056  0.3457       1.29x
    Isaac tabletop                            0.8667  0.7955  0.8706       1.23x

    rendered ratio 8.33x (3.06 stops); with --albedo 0.300722
    --reference-albedo 0.142686 the lighting ratio is 3.95x (1.98 stops)

The whole-frame numbers for the same runs, plus a third run walking the hall, are recorded
in `WHOLE_FRAME_EGO_LUMINANCE` in the layout module as a counter-example. Nothing is derived
from them.

Two details of the sampling are load-bearing, which is why they are defaults and not
hard-coded: the frames are the FIRST 12 by filename, not 12 spread across the run, and the
statistics are POOLED over all of those frames' pixels rather than averaged per frame.
Evenly-spread sampling moves the MuJoCo whole-frame p90 from 0.870 to 0.929 -- the episode
ends with the arm filling the frame -- so a comparison made with one sampling and judged
against a table made with the other is not a comparison. `--sample even` and `--sample all`
exist for when a whole run is the question; say which one was used when quoting a number.

REQUIREMENTS
------------
numpy and PIL. Both are in `/home/humanoid/anaconda3/envs/unitree_sim_env6/`, which is the
interpreter every other offline tool in this directory is run with.

Exit status: 0 if every measured directory is inside the band (or no `--reference` was
given), 1 otherwise -- so it can gate a sweep without a human reading two tables.

@status new -- offline measurement tool for isaac_scenes/, not part of the shipped robot software
"""

from __future__ import annotations

import argparse
import glob
import math
import os
import sys

try:
    import numpy as np
except ImportError:  # pragma: no cover - the message is the whole value here
    sys.exit("measure_scene_exposure.py needs numpy. Try "
             "/home/humanoid/anaconda3/envs/unitree_sim_env6/bin/python")

try:
    from PIL import Image
except ImportError:  # pragma: no cover
    sys.exit("measure_scene_exposure.py needs PIL. Try "
             "/home/humanoid/anaconda3/envs/unitree_sim_env6/bin/python")

IMAGE_EXTENSIONS = (".jpg", ".jpeg", ".png", ".ppm", ".bmp")

# Rec. 709 luminance weights, on sRGB-ENCODED values. Same weights as the layout module's
# `relative_luminance`; that one takes a single triple, this one a whole image.
LUMA = (0.2126, 0.7152, 0.0722)

# Percentiles are read from a histogram rather than from a pooled pixel array, so that
# `--sample all` on a 2000-frame run costs 512 kB instead of 12 GB. 65536 bins put the
# quantisation error at 1.5e-5, five orders below the third decimal these numbers are ever
# quoted to; the mean and the saturated fraction are accumulated exactly and not binned.
HIST_BINS = 65536


def srgb_to_linear(u):
    """sRGB encoded value(s) in [0, 1] -> linear light. IEC 61966-2-1, vectorised.

    The layout module carries the scalar form of the same curve. Neither file gets to
    choose a different one; it is the standard curve, and it is the entire reason the
    required exposure cut is 7x and not the 2.5x the encoded medians suggest.
    """
    u = np.asarray(u, dtype=np.float64)
    return np.where(u <= 0.04045, u / 12.92, ((u + 0.055) / 1.055) ** 2.4)


class Accumulator:
    """Pooled luminance statistics over an arbitrary number of frames, in bounded memory."""

    def __init__(self, saturation: float, rois=()) -> None:
        self.saturation = saturation
        # Rectangles, x0,y0,x1,y1, half-open, in pixels. Empty means the whole frame. Every
        # rectangle contributes its pixels to ONE pooled distribution: three patches of the
        # same tabletop are one measurement of that tabletop, not three.
        self.rois = tuple(rois)
        self.out_of_frame = 0
        self.hist = np.zeros(HIST_BINS, dtype=np.int64)
        self.total = 0            # pixels
        self.sum = 0.0            # sum of luminance, for an exact mean
        self.over = 0             # pixels strictly above `saturation`, counted exactly
        self.frames = 0
        self.size: tuple[int, int] | None = None
        self.sizes_differ = False

    def add(self, path: str) -> None:
        with Image.open(path) as img:
            rgb = np.asarray(img.convert("RGB"), dtype=np.float32) / np.float32(255.0)
        if self.size is None:
            self.size = (rgb.shape[1], rgb.shape[0])
        elif self.size != (rgb.shape[1], rgb.shape[0]):
            # Not fatal: pooling mixed resolutions weights the larger frames more, which is
            # a defensible thing to want. It is reported so nobody discovers it in a graph.
            self.sizes_differ = True
        plane = LUMA[0] * rgb[..., 0] + LUMA[1] * rgb[..., 1] + LUMA[2] * rgb[..., 2]
        if self.rois:
            parts = []
            h, w = plane.shape
            for x0, y0, x1, y1 in self.rois:
                if x1 > w or y1 > h:
                    self.out_of_frame += 1
                    continue
                parts.append(plane[y0:y1, x0:x1].ravel())
            if not parts:
                raise ValueError(
                    f"every --roi falls outside {path} ({w}x{h}). The rectangles the "
                    "factory scene is calibrated with are for 640x480 frames; a rectangle "
                    "that silently clipped would measure a different surface and still "
                    "print a number.")
            lum = np.concatenate(parts)
        else:
            lum = plane.ravel()
        self.frames += 1
        self.total += lum.size
        self.sum += float(lum.astype(np.float64).sum())
        self.over += int((lum > self.saturation).sum())
        bins = np.clip((lum * HIST_BINS).astype(np.int64), 0, HIST_BINS - 1)
        self.hist += np.bincount(bins, minlength=HIST_BINS)

    def percentile(self, q: float) -> float:
        """The q-th percentile of the pooled luminance, from the histogram."""
        if self.total == 0:
            return float("nan")
        target = (self.total - 1) * (q / 100.0)
        cum = np.cumsum(self.hist)
        idx = int(np.searchsorted(cum, math.floor(target) + 1, side="left"))
        return (idx + 0.5) / HIST_BINS

    @property
    def mean(self) -> float:
        return self.sum / self.total if self.total else float("nan")

    @property
    def saturated_fraction(self) -> float:
        return self.over / self.total if self.total else float("nan")

    def summary(self) -> dict:
        p10, p90 = self.percentile(10.0), self.percentile(90.0)
        lin_med = float(srgb_to_linear(self.percentile(50.0)))
        lin_p10, lin_p90 = float(srgb_to_linear(p10)), float(srgb_to_linear(p90))
        return {
            "frames": self.frames,
            "pixels": self.total,
            "mean": self.mean,
            "median": self.percentile(50.0),
            "p10": p10,
            "p90": p90,
            "saturated": self.saturated_fraction,
            "linear_median": lin_med,
            # p90/p10 in linear light: how much dynamic range the frame actually uses. A
            # scene with filled-in shadows lands near 1; the MuJoCo training frames are at
            # 10.8. Guarded because a fully black tenth percentile is possible in principle.
            "spread": (lin_p90 / lin_p10) if lin_p10 > 1e-9 else float("inf"),
        }


def frames_in(directory: str, limit: int, sample: str) -> list[str]:
    """The frames this run measures, and in the order the table above was made with.

    Sorted by filename, then: `first` takes the leading `limit` (the default, and what the
    recorded table used), `even` spreads `limit` across the whole run, `all` takes
    everything. Which one was used changes the answer -- see the module docstring.
    """
    files = sorted(f for f in glob.glob(os.path.join(directory, "*"))
                   if f.lower().endswith(IMAGE_EXTENSIONS))
    if not files or sample == "all" or limit <= 0 or limit >= len(files):
        return files
    if sample == "first":
        return files[:limit]
    idx = np.linspace(0, len(files) - 1, limit).round().astype(int)
    return [files[i] for i in idx]


def parse_roi(text: str) -> tuple[int, int, int, int]:
    """`x0,y0,x1,y1` -> a half-open rectangle. Raises rather than clipping."""
    parts = [p.strip() for p in text.split(",")]
    if len(parts) != 4:
        raise argparse.ArgumentTypeError(
            f"--roi {text!r}: expected four comma-separated integers x0,y0,x1,y1")
    try:
        x0, y0, x1, y1 = (int(p) for p in parts)
    except ValueError:
        raise argparse.ArgumentTypeError(f"--roi {text!r}: not four integers") from None
    if x1 <= x0 or y1 <= y0 or x0 < 0 or y0 < 0:
        raise argparse.ArgumentTypeError(
            f"--roi {text!r}: needs 0 <= x0 < x1 and 0 <= y0 < y1")
    return (x0, y0, x1, y1)


def measure(directory: str, limit: int, sample: str, saturation: float,
            rois=()) -> dict | None:
    files = frames_in(directory, limit, sample)
    if not files:
        return None
    acc = Accumulator(saturation, rois)
    for path in files:
        acc.add(path)
    out = acc.summary()
    out["directory"] = directory
    out["size"] = acc.size
    out["sizes_differ"] = acc.sizes_differ
    out["rois"] = tuple(rois)
    out["out_of_frame"] = acc.out_of_frame
    return out


def roi_text(rois) -> str:
    return ("WHOLE FRAME (see the docstring before comparing scenes)" if not rois
            else " + ".join(f"[{x0},{y0} -> {x1},{y1}]" for x0, y0, x1, y1 in rois))


def label_for(directory: str) -> str:
    """A short name for the table: the last two path components, which is what identifies
    a run here (`grasp3-002355/grasp_frames`, `ab_on/ep_seed0`)."""
    parts = [p for p in os.path.normpath(directory).split(os.sep) if p]
    return "/".join(parts[-2:]) if len(parts) >= 2 else (parts[-1] if parts else directory)


def print_table(rows: list[dict], saturation: float) -> None:
    labels = [label_for(r["directory"]) for r in rows]
    w = max([len(x) for x in labels] + [len("scene")])
    head = (f"  {'scene'.ljust(w)}  frames    mean  median     p10     p90  "
            f"frac > {saturation:.2f}")
    print(head)
    print("  " + "-" * (len(head) - 2))
    for label, r in zip(labels, rows):
        print(f"  {label.ljust(w)}  {r['frames']:6d}  {r['mean']:6.3f}  {r['median']:6.3f}  "
              f"{r['p10']:6.3f}  {r['p90']:6.3f}  {100 * r['saturated']:9.1f} %")


def print_comparison(rows: list[dict], reference: dict, band_stops: float,
                     albedo: float | None, ref_albedo: float | None) -> int:
    """Each directory against the reference, in scene-linear light. Returns the fail count."""
    ref_lin = reference["linear_median"]
    ref_label = label_for(reference["directory"])
    print(f"\nagainst the reference ({ref_label}), in SCENE-LINEAR light")
    print("-" * 88)
    print(f"  reference median {reference['median']:.4f} encoded -> {ref_lin:.4f} linear; "
          f"p90/p10 spread {reference['spread']:.2f}x")
    if ref_albedo:
        print(f"  reference albedo {ref_albedo:.6f} -> lighting gain "
              f"{ref_lin / ref_albedo:.4f}")
    print(f"  band: within +/- {band_stops:.2f} stop"
          f"{'' if band_stops == 1 else 's'} "
          f"({2 ** -band_stops:.2f}x to {2 ** band_stops:.2f}x of the reference)")
    print()
    failures = 0
    for r in rows:
        if r["directory"] == reference["directory"]:
            continue
        ratio = r["linear_median"] / ref_lin if ref_lin > 0 else float("inf")
        stops = math.log2(ratio) if ratio > 0 else float("-inf")
        inside = abs(stops) <= band_stops
        failures += 0 if inside else 1
        verdict = "IN BAND" if inside else ("TOO BRIGHT" if stops > 0 else "TOO DARK")
        print(f"  {label_for(r['directory'])}")
        print(f"      median {r['median']:.4f} encoded -> {r['linear_median']:.4f} linear")
        print(f"      {ratio:6.2f}x the reference RENDERED  =  {stops:+.2f} stops   ->  "
              f"{verdict}")
        if albedo and ref_albedo:
            # Rendered light = albedo x illumination. Dividing each side by its own surface
            # albedo is what separates a palette error from an exposure error; without it a
            # table painted twice as light reads as a room lit twice as brightly.
            alb_ratio = albedo / ref_albedo
            light = ratio / alb_ratio
            print(f"      albedo {albedo:.6f} vs {ref_albedo:.6f} = {alb_ratio:.2f}x, so "
                  f"the LIGHTING ratio is {light:.2f}x ({math.log2(light):+.2f} stops)")
            print(f"      -> divide every light in the scene by {light:.2f} and repaint the "
                  f"surface {alb_ratio:.2f}x darker; the two multiply to {ratio:.2f}x")
        elif albedo or ref_albedo:
            print("      (only one of --albedo / --reference-albedo was given; both are "
                  "needed to separate palette from exposure)")
        if not inside:
            direction = "cut" if stops > 0 else "raise"
            print(f"      to land on the reference, {direction} the RENDERED light by "
                  f"{abs(stops):.2f} stops (x{1 / ratio:.3f}) -- by lights, by albedo, or "
                  "by both")
        spread_note = f"      p90/p10 spread {r['spread']:.2f}x against the reference's " \
                      f"{reference['spread']:.2f}x"
        if r["spread"] > 0 and math.isfinite(r["spread"]):
            spread_note += f"  ({reference['spread'] / r['spread']:.1f}x flatter)"
        print(spread_note)
        print()
    print("  The spread is reported, NOT judged. A run can land in the band and still be")
    print("  flat -- and over a whole frame the spread is mostly albedo contrast anyway.")
    print("  The ratio inverts the sRGB encode but not RTX's ACES-approximation tonemapper,")
    print("  which is compiled into the plugin. Substituting the standard Narkowicz curve on")
    print("  the Isaac side moves the factory scene's 8.33x to 8.23x -- about 1 %. Close and")
    print("  reproducible, but an approximation, not a bound.")
    if not reference.get("rois"):
        print()
        print("  !! NO --roi WAS GIVEN. These are WHOLE-FRAME medians. If the two runs do")
        print("     not show the same thing -- and a tabletop close-up and a wide shot of a")
        print("     hall do not -- this is a comparison of content, not of light. See the")
        print("     module docstring; it is the mistake this tool was built after making.")
    return failures


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("directories", nargs="+", help="directories of frames to measure")
    ap.add_argument("--reference", default=None,
                    help="a directory of frames representing the TRAINING look. Every "
                         "other directory is compared against it and gets a verdict. "
                         "Measured and printed alongside the others.")
    ap.add_argument("--limit", type=int, default=12,
                    help="frames per directory (default 12, which is what the recorded "
                         "table used). 0 or negative means all of them.")
    ap.add_argument("--sample", choices=("first", "even", "all"), default="first",
                    help="which frames: the leading --limit (default, and what the "
                         "recorded table used), --limit spread evenly across the run, or "
                         "every frame. This CHANGES THE ANSWER -- see the docstring.")
    ap.add_argument("--band", type=float, default=0.5, metavar="STOPS",
                    help="half-width of the in-distribution band, in stops (default 0.5, "
                         "i.e. 0.71x to 1.41x of the reference's scene-linear median). "
                         "There is no measured justification for 0.5 -- nobody has tested "
                         "how much exposure shift this policy tolerates. It is a "
                         "deliberately tight default so a sweep has to argue its way out.")
    ap.add_argument("--saturation", type=float, default=0.90, metavar="L",
                    help="luminance above which a pixel counts as saturated (default 0.90)")
    ap.add_argument("--roi", type=parse_roi, action="append", default=[],
                    metavar="X0,Y0,X1,Y1",
                    help="measure only this rectangle, half-open, in pixels. Repeatable; "
                         "all rectangles pool into one distribution. WITHOUT THIS THE TOOL "
                         "MEASURES WHOLE FRAMES, which is a comparison of content and not "
                         "of light unless the runs show the same thing -- see the "
                         "docstring. Applies to every directory including the reference "
                         "unless --reference-roi is given.")
    ap.add_argument("--reference-roi", type=parse_roi, action="append", default=[],
                    metavar="X0,Y0,X1,Y1",
                    help="rectangles for the reference directory only, for when the same "
                         "surface sits somewhere else in the training frames (it does).")
    ap.add_argument("--albedo", type=float, default=None, metavar="L",
                    help="Rec. 709 luminance of the measured surface's diffuse colour. "
                         "Given with --reference-albedo, the tool divides both out and "
                         "reports the LIGHTING ratio separately from the rendered one, "
                         "which is the only way to tell a repaint from an exposure error.")
    ap.add_argument("--reference-albedo", type=float, default=None, metavar="L",
                    help="the same, for the reference surface.")
    args = ap.parse_args()

    targets = list(args.directories)
    if args.reference and args.reference not in targets:
        targets.insert(0, args.reference)

    print("=" * 88)
    print("ego-view luminance  --  0.2126R + 0.7152G + 0.0722B on sRGB values in [0, 1]")
    per_dir = ("every frame" if args.sample == "all" or args.limit <= 0
               else f"{args.limit} frame(s) per directory")
    print(f"  sampling      : {args.sample}, {per_dir}")
    print("  statistics    : POOLED over every measured pixel, not averaged per frame")
    ref_rois = tuple(args.reference_roi) or tuple(args.roi)
    print(f"  region        : {roi_text(tuple(args.roi))}")
    if ref_rois != tuple(args.roi):
        print(f"  reference     : {roi_text(ref_rois)}")
    print("=" * 88 + "\n")

    rows: list[dict] = []
    for directory in targets:
        if not os.path.isdir(directory):
            print(f"  [SKIP] {directory} is not a directory", file=sys.stderr)
            continue
        rois = ref_rois if directory == args.reference else tuple(args.roi)
        result = measure(directory, args.limit, args.sample, args.saturation, rois)
        if result is None:
            print(f"  [SKIP] {directory} holds no {'/'.join(IMAGE_EXTENSIONS)} frames",
                  file=sys.stderr)
            continue
        rows.append(result)

    if not rows:
        print("nothing measured.", file=sys.stderr)
        return 1

    print_table(rows, args.saturation)
    for r in rows:
        if r["out_of_frame"]:
            print(f"\n  note: {label_for(r['directory'])} -- {r['out_of_frame']} "
                  "rectangle-frame pair(s) were skipped because the rectangle fell outside "
                  "the frame. Check --roi against the frame size.")
        if r["sizes_differ"]:
            print(f"\n  note: {label_for(r['directory'])} mixes frame sizes; pooling weights "
                  "the larger frames more heavily.")

    if not args.reference:
        print("\n  No --reference given, so there is no verdict -- this is a table for a")
        print("  human to eyeball against another table, which is the thing this tool")
        print("  exists to replace. Pass --reference <the MuJoCo training frames> to get")
        print("  a ratio in stops and an in-band / out-of-band answer.")
        return 0

    reference = next((r for r in rows if r["directory"] == args.reference), None)
    if reference is None:
        print(f"\n  the reference directory {args.reference} could not be measured.",
              file=sys.stderr)
        return 1

    failures = print_comparison(rows, reference, args.band, args.albedo,
                                args.reference_albedo)
    measured = len(rows) - 1
    print("=" * 88)
    if measured == 0:
        print("RESULT: nothing to compare -- only the reference was measured.")
    elif failures:
        print(f"RESULT: OUT OF THE TRAINING DISTRIBUTION  --  {failures} of {measured} "
              f"directories outside +/- {args.band:.2f} stops")
    else:
        print(f"RESULT: IN THE TRAINING DISTRIBUTION  --  all {measured} directories "
              f"within +/- {args.band:.2f} stops")
    print("=" * 88)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())

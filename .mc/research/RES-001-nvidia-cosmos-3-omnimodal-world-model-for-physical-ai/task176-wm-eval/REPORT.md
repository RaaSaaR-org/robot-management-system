# TASK-176 — Cosmos 3 world-model simulator: feasibility results

- Space: `nvidia/Cosmos3-Action-Viewer-Prerelease`  | num_steps=30 guidance=1.0
- Metric: luminance SSIM (uniform 7px window) + PSNR vs ground truth
- Policy variants ranked per sequence by mean SSIM (frames>=1) vs the **real** recorded future.

## Per-sequence ranking

Two metrics: **global SSIM** (full-frame, confounded by static background) and **motion_corr** (correlation of predicted vs real change-maps — a do-nothing policy scores ~0, so it is the fair policy-ranking metric).

| seq | cond frame | GT motion | global-SSIM ranking | real #1? | motion_corr ranking | real #1? |
|----|----|----|----|----|----|----|
| 0 | 0 | 2.879 | zero > real > scrambled > reversed | ❌ | real > reversed > scrambled > zero | ✅ |
| 3 | 3 | 2.849 | zero > reversed > real > scrambled | ❌ | reversed > zero > scrambled > real | ❌ |
| 6 | 6 | 3.081 | zero > reversed > real > scrambled | ❌ | reversed > scrambled > zero > real | ❌ |
| 23 | 23 | 5.754 | zero > reversed > scrambled > real | ❌ | scrambled > reversed > zero > real | ❌ |

## Per-variant metrics

| seq | variant | global SSIM↑ | masked SSIM↑ | motion_corr↑ | PSNR↑ | interframe motion |
|----|----|----|----|----|----|----|
| 0 | zero | 0.8701 | 0.51 | 0.0429 | 18.5 | 0.488 |
| 0 | real | 0.8689 | 0.5246 | 0.3207 | 17.34 | 2.225 |
| 0 | scrambled | 0.858 | 0.5095 | 0.2057 | 17.54 | 2.583 |
| 0 | reversed | 0.8548 | 0.4862 | 0.2064 | 16.57 | 2.636 |
| 3 | zero | 0.8621 | 0.466 | 0.3088 | 18.17 | 0.801 |
| 3 | real | 0.8504 | 0.4641 | 0.2113 | 15.64 | 2.823 |
| 3 | scrambled | 0.8435 | 0.4393 | 0.232 | 16.38 | 3.931 |
| 3 | reversed | 0.8554 | 0.4778 | 0.5094 | 18.22 | 3.8 |
| 6 | zero | 0.8693 | 0.5237 | 0.2197 | 19.98 | 0.858 |
| 6 | real | 0.842 | 0.4548 | 0.157 | 17.38 | 3.42 |
| 6 | scrambled | 0.8256 | 0.4566 | 0.2375 | 17.36 | 3.828 |
| 6 | reversed | 0.86 | 0.5312 | 0.4564 | 19.86 | 3.066 |
| 23 | zero | 0.8436 | 0.5923 | 0.3043 | 17.17 | 1.82 |
| 23 | real | 0.8253 | 0.5362 | 0.1961 | 15.86 | 5.05 |
| 23 | scrambled | 0.8315 | 0.5741 | 0.3509 | 17.19 | 5.138 |
| 23 | reversed | 0.8325 | 0.5657 | 0.3346 | 17.18 | 4.917 |

## Summary

- Sequences: 4.
- real ranked #1 by **global SSIM** in 0/4 (discriminative: False).
- real ranked #1 by **motion_corr** in 1/4 (discriminative: False).

See `report.json` for per-frame SSIM curves and `strip_si*.png` for qualitative GT-vs-prediction comparisons.

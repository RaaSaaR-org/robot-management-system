---
id: "TASK-385"
aliases: []
title: "test-all.sh is green on a stock Mac and runs the SmolVLA tests"
slug: "test-all-sh-is-green-on-a-stock-mac-and-runs-the-smolvla-tests"
status: "review"
priority: 2
owner: "huhn511"
projects: []
customers: []
tags: ["core"]
sprint: ""
parent: ""
depends_on: []
spe: 2
effort: "low"
due_date: ""
created: "2026-10-13"
updated: "2026-10-13"
---

# test-all.sh is green on a stock Mac and runs the SmolVLA tests

## Description
`./scripts/test-all.sh --skip-pw` is red on every Mac where `python3` is the stock
`/usr/bin/python3` (3.9.6), and its hardware stage silently skips the SmolVLA backend
and runner tests even when the curation venv that can run them is present. Make the
documented entry point green and make it cover what CLAUDE.md says it covers.

## Details

**Current state.**

- Stage 3d (Isaac offline verifiers) in `scripts/test-all.sh` runs with
  `HARDWARE_PYTHON` or bare `python3`, with no venv fallback. Two of the four
  "stdlib-only, any python3" verifiers use PEP 701 f-strings (backslashes inside the
  expression part), which are a `SyntaxError` before Python 3.12:
  - `robot-agent/hardware/verify_isaac_manip_offline.py` (~line 786,
    `f"{scode.count('watch_pid \"$')} call sites"`)
  - `robot-agent/hardware/isaac_scenes/common_scene/make_pause_room_door_usda.py`
    (~lines 250-260), imported by
    `robot-agent/hardware/isaac_scenes/verify_factory_scene_offline.py`.
  CI is green only because `.github/workflows/check.yml` pins Python 3.12.
- Stage 3c (hardware sidecar pytest) picks the sim venv before the curation venv and
  never reads `SIM_PYTHON` / `CURATION_PYTHON`. The sim venv has no `httpx`, so the 17
  `SmolVLABackend` cases in `robot-agent/hardware/tests/test_backends.py` and
  `test_vla_runner.py` skip, and the run summary does not mention it.

### Scripts

- Rewrite the offending f-strings so the files parse on Python 3.9 (hoist the
  escaped expression into a variable).
- Stage 3c: when `HARDWARE_PYTHON` is unset, try `CURATION_PYTHON`, the curation
  venv, `SIM_PYTHON`, the sim venv; take the first with numpy + pytest + httpx, else
  the first with numpy + pytest. When the chosen interpreter has no httpx, print a
  note in the stage and in the summary that the SmolVLA tests did not run.
- Stage 3d: `HARDWARE_PYTHON` if it runs, else the same venv candidates, else
  `python3`.

**Key files:** `scripts/test-all.sh`,
`robot-agent/hardware/verify_isaac_manip_offline.py`,
`robot-agent/hardware/isaac_scenes/common_scene/make_pause_room_door_usda.py`,
`CLAUDE.md` (Testing section).

## Acceptance Criteria
- [x] `/usr/bin/python3 robot-agent/hardware/verify_isaac_manip_offline.py` and
      `/usr/bin/python3 robot-agent/hardware/isaac_scenes/verify_factory_scene_offline.py`
      exit 0 on Python 3.9.
- [x] The generated USDA from `make_pause_room_door_usda.py` is byte-identical before
      and after the change.
- [x] With both default venvs present and `HARDWARE_PYTHON` unset, the hardware stage
      runs on the curation venv and the SmolVLA cases are not skipped.
- [x] When the hardware interpreter has no httpx, the stage and the summary say the
      SmolVLA tests did not run.
- [x] Stage 3d falls back to a venv before bare `python3`.
- [x] `./scripts/test-all.sh --skip-pw` exits 0 on a stock Mac with the default venvs.

## Test Strategy
Run both verifiers under `/usr/bin/python3` and under the curation venv; diff the
USDA output before/after; run `./scripts/test-all.sh --skip-pw` once and check the
hardware stage's pass/skip counts and the summary.

## Notes
Found by the 2026-10-13 system gate review.

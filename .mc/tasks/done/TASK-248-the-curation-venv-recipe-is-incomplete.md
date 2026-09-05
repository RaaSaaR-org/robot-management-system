---
id: "TASK-248"
aliases: []
title: "The curation venv recipe in CLAUDE.md builds a broken venv"
slug: "the-curation-venv-recipe-is-incomplete"
status: "done"
priority: 3
owner: "huhn511"
projects: []
customers: []
tags: ["core"]
sprint: ""
parent: ""
depends_on: []
spe: 1
effort: ""
due_date: ""
created: "2026-09-05"
updated: "2026-09-05"
---

# The curation venv recipe in CLAUDE.md builds a broken venv

## Description

`CLAUDE.md:94` tells you to create `CURATION_PYTHON` as "a venv with pyarrow + pandas +
pytest". Follow that literally and five of the curation tests error out. The file it points at
is right; the summary is not.

## Details

### Current state

`CLAUDE.md` opens the section by warning that all three Python stages report **SKIPPED rather
than failed** when their interpreter is missing — "a run that says all tests passed may have
run none of them". That is exactly why the recipe has to be right: someone acting on it gets a
venv that looks set up and then errors, which is the failure mode one line above it.

Following it on 2026-09-05 produced:

```
$ python3 -m venv .venv && .venv/bin/pip install pyarrow pandas pytest
$ .venv/bin/python -m pytest server/curation/tests/ -q
31 passed, 1 skipped, 5 errors
  ModuleNotFoundError: No module named 'imageio'
```

and after adding `imageio`:

```
ValueError: Could not find a backend to open '.../video.mp4' with iomode 'w?'
```

`server/curation/requirements.txt` already lists everything — `imageio>=2.31` and
`imageio-ffmpeg>=0.4.9` are there with a comment saying why (the neural-traj mock backend
writes the synthetic clips). Installing from it gives **36 passed, 1 skipped**, verified in a
throwaway venv.

So the fix is to stop paraphrasing the dependency list in a second place. A summary that can
drift from `requirements.txt` will.

### Key files

- `CLAUDE.md` — the `CURATION_PYTHON` bullet

## Acceptance Criteria

- [ ] `CLAUDE.md` names `requirements.txt` rather than restating three of its packages
- [ ] Following the instruction verbatim produces a venv where
      `server/curation/tests/` passes

## Test Strategy

Create a venv from scratch with only what the instruction says, and run the suite. It must be
36 passed, 1 skipped — not 31 and 5 errors.

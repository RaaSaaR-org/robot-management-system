---
id: "TASK-473"
aliases: []
title: "The two-person runbook covers the edit flow, desktop E-stop recovery and where the data lives"
slug: "the-two-person-runbook-covers-the-edit-flow-desktop-e-stop"
status: "todo"                # backlog | todo | in-progress | review | done | cancelled
priority: 3                   # 1=critical, 2=high, 3=medium, 4=low
owner: "claude"
projects: []
customers: []
tags: [core, docs]
sprint: ""
parent: ""
depends_on: []
spe: 2
effort: "low"
due_date: ""
created: "2026-10-31"
updated: "2026-10-31"
---

# The two-person runbook covers the edit flow, desktop E-stop recovery and where the data lives

## Description

The 2026-10-31 sim rehearsal followed `docs/data-collection-two-person.md` end
to end and found twelve places where it is silent or wrong: nothing on what to
do with the data after a session, an E-stop recovery that assumes the operator
is in VR, a wrap-up button that no longer exists, and no word on where the
dataset is stored. This task brings the runbook in line with what the app does
on `main`, and marks each workaround with the task that will remove it.

Branch: `docs/task-473-the-two-person-runbook-covers-the-edit-flow-desktop-e-stop`.

## Details

### Current state

Checked on `main` at `a600c27e`, `docs/data-collection-two-person.md`
(368 lines; sections Roles, What the assistant sees, Setup, Recording takes,
Who presses what, After an E-stop, What the warnings mean, Remote testing):

- `:121-125` and `:270-273`: Wrap up's action is "Create dataset". End session
  already exports the dataset; the band shows **Open dataset**.
- `:136-141` (Setup step 0): Task is described as "the task"; it is both the
  session name and the training instruction (`meta/tasks.jsonl`).
- `:264`: Esc Esc is E-STOP, with no warning that an Esc closing a popover or
  dialog counts.
- `:275-303` (After an E-stop): assumes the operator is in VR (the "Ask the
  headset" relay). No desktop-only path.
- `:308`: "Every take button is disabled" while the E-stop is latched; Start
  take stays enabled (TASK-459 fixes it).
- `:315`: "Frames are being missed" is explained as "the robot agent is
  unreachable"; it usually means nobody drives yet, and it hides the quick
  check (TASK-464 fixes it).
- No section on the keyboard fallback's order, the edit flow after a session,
  or where the data lives.

### Docs

Add or change, in the runbook's style (short steps, tables, bold button names):

1. **Setup step 0:** type only the instruction in Task (e.g. "Pick up the red
   cube and place it on the plate"); names and dates go in Advanced options →
   Dataset name (e.g. `neodem/g1-redcube-2026-10-31`). TASK-467 adds a name
   field.
2. **Before the session:** end every session before leaving; a paused session
   left on the robot can catch the headset's live link (TASK-452).
3. **After an E-stop, without a headset in VR:** robot Teleop tab
   (`/robots/<robot>?tab=teleop`) → Release keyboard control if it is held →
   Launch VR → Take control (confirm) → Stand up (confirm) → wait for Stand →
   Balance (confirm) → Close → back to the session page. TASK-463 moves this
   onto the session page.
4. **Warnings table:** while the E-stop is latched, Start take stays enabled;
   reset and wait for Balance first (until TASK-459). "Frames are being missed"
   usually means teleop is not engaged yet; read the takes list badges instead
   (until TASK-464).
5. **Keyboard fallback order:** with Testing tools closed, Space starts the
   take; then Testing tools → Keyboard fallback → Open → Connect → Take control
   → confirm; drive with ↑↓ (select), ←→ (move), H (home); close with one Esc
   or a click on Testing tools; wait more than 1 s; Space stops the take.
   Clicking the take dock while the popover is open drops control and starts
   nothing (until TASK-465).
6. **Esc warning** next to the Esc Esc row: an Esc that closes a popover or a
   dialog also counts. Close them with the mouse (until TASK-466).
7. **Wrap up:** End session exports automatically; the band shows **Open
   dataset**, not Create dataset. "Recorded" is the session's wall time, not
   the takes' time; use frames / fps (until TASK-470).
8. **A new section, "After the session: edit the dataset"** (from the
   rehearsal's edit flow):
   - Wrap up → Open dataset (`/datasets/<id>/episodes`).
   - Trim range and Delete episode each write a new "<name> (curated)" dataset
     (LeRobot v2.1) and leave the page on the original. After every edit,
     scroll under Curate → **Open new dataset**, and make the next edit there;
     otherwise edits fork from the original and do not combine (TASK-455).
   - Flags, star ratings and comments do not exclude episodes from training.
     Use Delete episode, or tick the good episodes → Create view → Write to
     disk (TASK-458 on a v3.0 dataset; TASK-468 adds one click).
   - Train on the newest "(curated)" dataset (Train on this dataset), or push it
     from the dataset menu (⋯ → Push to Hugging Face).
9. **A new section, "Where the data lives":** the robot agent writes each
   session's LeRobot v3.0 dataset on the robot PC, under
   `RECORDING_DATASET_DIR` when it is set, else
   `robot-agent/data/workspace-<robotId>/datasets/<sessionId>/`
   (`robot-agent/src/recording/recording-controller.ts:32-36`); curated copies
   sit beside it as `<sessionId>__trim-<ts>/`. Local disk only: this path never
   uploads to RustFS, and nothing reaches Hugging Face unless someone pushes it
   from the dataset menu. Name who holds the Hugging Face write token for the
   session.
10. **Sim rehearsal caveat:** the `sim-g1-edu-dev` profile has no head camera
    (`G1_CAMERA_SOURCE` none), so video, thumbnails and the headset's head
    screen are not rehearsed there. Before collecting at scale on the real
    robot, check the head camera (PC2 port 5600) and `ffprobe` one short take's
    `videos/` folder.

Keep every statement true of `main` at the time of the PR; when one of the
named tasks has merged, write the fixed behaviour instead of the workaround.

### Key files

- `docs/data-collection-two-person.md`

## Acceptance Criteria

- [ ] All ten points above are in the runbook, each workaround naming its task.
- [ ] No "Create dataset" as the wrap-up action remains.
- [ ] The runbook's anchors still work (`#after-an-e-stop` and the links into
  `g1-edu-lab-bringup.md`); new sections have their own anchors.
- [ ] Every path and button name was checked against `main`.

## Test Strategy

- Read the runbook against the app on `sim-g1-edu-dev` once: New session, a
  keyboard take, E-STOP and the desktop recovery, End session, one Trim and
  Open new dataset.
- `grep -n "Create dataset" docs/data-collection-two-person.md` finds no wrap-up
  instruction.

## Notes

- From the 2026-10-31 sim rehearsal's runbook gaps (all twelve are covered by
  the ten points above).

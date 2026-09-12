---
id: "TASK-297"
aliases: []
title: "Sweep app catches onto the shared error helpers"
slug: "sweep-app-catches-onto-the-shared-error-helpers"
status: "review"
priority: 3
owner: "huhn511"
projects: []
customers: []
tags: [core, app]
sprint: ""
parent: "[[TASK-281]]"
depends_on: []
spe: 5
effort: "low"
due_date: ""
created: "2026-09-12"
updated: "2026-09-12"
---

# Sweep app catches onto the shared error helpers

## Description

165 sites across 55 files in `app/src` write `error instanceof Error ? error.message : '<fallback>'` on the api path, where the rejection is never an `Error`. Two correct helpers already exist and 120 files use them. This task sweeps the mechanical sites onto those helpers, deletes six local duplicates of the same helper, leaves the 14 sites that legitimately need `instanceof Error`, and adds a ratchet to `scripts/test-all.sh` so feature stores cannot reacquire the pattern.

## Details

### Current state

165 non-test sites across 55 files, distributed as:

- 119 sites across 23 feature stores
- 21 sites across 17 components
- 17 sites across 11 hooks
- 8 sites across 4 shared files

Of those, **151 are the exact `X instanceof Error ? X.message : '<fallback>'` shape** and are pure find-and-replace. The correct destinations:

- `getErrorMessage(error, '<fallback>')` — `app/src/shared/utils/error.ts:44`, barrel `@/shared/utils` — for stores and hooks
- `errorMessage(err, '<fallback>')` — `app/src/shared/components/ui/errorMessage.ts:38`, barrel `@/shared/components/ui` — for toasts and form errors

Copy the store pattern from `app/src/features/datacollection/store/datacollectionStore.ts:100-101`, which is already correct.

**Six local duplicates of the shared helper, to delete** (point their callers at the barrel instead):

- `app/src/features/organizations/store/organizationsStore.ts:23-29`
- `app/src/features/team/store/serviceAccountsStore.ts:19`
- `app/src/features/team/store/teamStore.ts:22`
- `app/src/features/deployment/components/deploymentHelpers.ts:100`
- `app/src/features/training/components/datasets/episodeFormat.ts:30`
- `app/src/features/robots/components/tabs/MotionTab.tsx:75`

**14 sites that must NOT be swept** — `instanceof Error` is correct at each:

- `app/src/shared/utils/error.ts:45`, `:89`, `:98` — the helper's own implementation
- `app/src/shared/hooks/useApi.ts:94` — an `AbortError` *name* check, not message extraction
- `app/src/features/auth/store/authStore.ts:100` — an `MFA_REQUIRED` sentinel comparison
- The four WebSocket-construction catches, which wrap `new WebSocket(...)` and not the api client, so a real `Error` genuinely arrives:
  - `app/src/features/agentmode/hooks/useAgentModeSocket.ts:188`
  - `app/src/features/a2a/hooks/useA2AStream.ts:179`
  - `app/src/features/tour/hooks/useTourEvents.ts:97`
  - `app/src/features/patrol/hooks/usePatrolEvents.ts:98`

**8 files are half-migrated** — they already call a helper *and* still contain `instanceof Error`: `authStore`, `organizationsStore`, `teamStore`, `serviceAccountsStore`, `deploymentHelpers`, `RobotMapPanel`, plus the two helper modules themselves. **Read these, do not blind-replace them.**

Adoption is also under-counted by a naive grep: 48 non-test files call `getErrorMessage` and 79 reference `errorMessage` (union 120), but both are reached through barrels (`@/shared/utils` 32 times vs the direct path 9 times), so grepping the direct module path finds only 9.

### Frontend

1. Sweep the 151 mechanical sites to the two helpers, choosing by context (store/hook → `getErrorMessage`; toast/form → `errorMessage`).
2. Delete the six local duplicates and repoint their callers at the barrel.
3. Leave the 14 judgment sites exactly as they are.
4. Read the 8 half-migrated files individually.

### The ratchet

**This replaces the eslint child that was dropped from the plan.** There is no eslint config, no lint script and no lint step anywhere in this repo — not in `app/`, `server/`, `robot-agent/`, and not in any of the five files under `.github/workflows/`. Standing eslint up would mean deciding what else to enable or suppress across the whole codebase, which is a separate concern from this epic and deserves its own task.

Instead add a grep stage to `scripts/test-all.sh` that fails when `instanceof Error` appears in a non-test file under `app/src/features/*/store/`, with an explicit allowance for `authStore.ts`'s sentinel use.

Place it inside the `if [ "$PYTHON_ONLY" = false ]; then` block, after the "App unit tests" stage at `:79-80`, and follow the existing stage idiom exactly — `step`, then increment `FAILURES` rather than exiting, so every stage still runs:

```bash
# ------------------------------------- 2b. Error-contract ratchet (TASK-297)
# app/src/api/client.ts rejects with a plain object, never an Error, so an
# `instanceof Error` branch in a store silently discards the server's sentence.
# getErrorMessage()/errorMessage() handle both shapes; authStore's use is a
# sentinel comparison, not message extraction, so it is allowed.
step "App store error-contract ratchet"
RATCHET_HITS="$(grep -rln 'instanceof Error' "$REPO_ROOT"/app/src/features/*/store \
  --include='*.ts' --include='*.tsx' 2>/dev/null \
  | grep -v '__tests__' | grep -v '/authStore\.ts$' || true)"
if [ -n "$RATCHET_HITS" ]; then
  echo "  instanceof Error in a feature store — use getErrorMessage()/errorMessage():"
  echo "$RATCHET_HITS" | sed 's/^/    /'
  FAILURES=$((FAILURES + 1))
else
  ok "no instanceof Error in app/src/features/*/store"
fi
```

Verify the stage actually fires before trusting it: reintroduce one `instanceof Error` in a store, run the script, confirm it fails, then remove it.

**Key files:**
- the 55 files carrying the 165 sites — enumerate them with the grep in step one, do not work from this list alone
- `app/src/features/organizations/store/organizationsStore.ts` — delete the local helper at `:23-29`
- `app/src/features/team/store/teamStore.ts` — delete the local helper at `:22`
- `app/src/features/team/store/serviceAccountsStore.ts` — delete the local helper at `:19`
- `app/src/features/deployment/components/deploymentHelpers.ts` — delete the local helper at `:100`
- `app/src/features/training/components/datasets/episodeFormat.ts` — delete the local helper at `:30`
- `app/src/features/robots/components/tabs/MotionTab.tsx` — delete the local helper at `:75`
- `app/src/features/datacollection/store/datacollectionStore.ts` — read only, the correct pattern to copy (`:100-101`)
- `app/src/shared/utils/error.ts` — read only, leave `:45`/`:89`/`:98` alone
- `scripts/test-all.sh` — add the ratchet stage after `:80`

## Acceptance Criteria

- [ ] No non-test file under `app/src/features/**/store/**` contains `instanceof Error` except `app/src/features/auth/store/authStore.ts`, whose use is a sentinel comparison.
- [ ] The six local duplicate helpers are deleted and their callers import from `@/shared/utils` or `@/shared/components/ui`.
- [ ] The four WebSocket-construction catches in `useAgentModeSocket`, `useA2AStream`, `useTourEvents` and `usePatrolEvents` still use `instanceof Error` and still surface their connect-failure message.
- [ ] `app/src/shared/utils/error.ts:45`/`:89`/`:98` and `app/src/shared/hooks/useApi.ts:94` are unchanged.
- [ ] `./scripts/test-all.sh --skip-pw` runs the new ratchet stage and it passes; reintroducing one `instanceof Error` in a feature store makes it fail.
- [ ] `cd app && npx tsc && npx vitest run` passes with no behavioural change to any existing test.
- [ ] `git diff --name-only main` lists no file under `app/src/components/layout/` or `app/src/components/docs/`.

## Test Strategy

**The mocked seam:** 32 feature test files reject with `new Error(...)` — the one shape the api client never produces — so they pass against code that discards every real server message. The sharpest is `app/src/features/safety/store/__tests__/safetyStore.test.ts:221` (`mockRejectedValue(new Error('estop fail'))`, asserted at `:227`).

**That seam is owned by TASK-296, not by this task.** This task is a behaviour-preserving sweep: after it, the same tests must pass unchanged, because the helpers return the same string for an `Error` that `instanceof Error` did. The proof that the sweep is correct is therefore:

1. The existing suite passes with no test edited — any test that needs changing means the sweep altered behaviour at that site, which is a bug in the sweep.
2. The new ratchet stage in `scripts/test-all.sh` fails on a reintroduced violation, verified by hand as described above.

For the six deleted local helpers, run the tests of each owning feature (`organizations`, `team`, `deployment`, `training`, `robots`) to confirm the barrel import resolves and behaves identically.

**File ownership in `safetyStore.test.ts`** — three tasks touch this file; keep to your own lines:
- **This task (TASK-297)** owns the six `instanceof Error` lines at `:115`, `:171`, `:198`, `:227`, `:253`, `:282`.
- **TASK-296** owns the `new Error('estop fail')` mock at line 221 and its assertion at `:227`.
- **TASK-295** owns the new E-stop reducer cases.

## Notes

**`depends_on` is deliberately empty.** The plan's critic struck the proposed edge onto TASK-296: `getErrorMessage`/`errorMessage` already handle both the `Error` and the `{ message }` shapes, so the sweep is correct whether or not TASK-296 has landed. Running TASK-296 first is a review convenience — it means this sweep can be reviewed for consistency rather than for correctness — not a blocker.

**This touches 55 files across nearly every feature and will conflict with almost any concurrent app branch.** Keep the branch short-lived and land it promptly. Peer Claude sessions edit this repo concurrently — if you find an unexpected diff in a file you swept, confirm before reverting it.

Adopting eslint properly — a config, a lint script, and a CI step — is worth its own task. The grep ratchet here is deliberately the minimum that prevents regression without forcing that decision now.

No file under `app/src/components/layout/**` or `app/src/components/docs/DocsSidebar.tsx` is touched — a parallel session owns those (TASK-273..280).

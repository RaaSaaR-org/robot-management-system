# Contributing to NeoDEM

Thanks for wanting to help. NeoDEM is open source (MIT) and built by EmAI Robotics GmbH in
Saarbrücken, Germany, together with a 24/7 agentic crew — AI agents write code, run tests,
triage issues and ship fixes while humans set direction. Human contributions go through exactly
the same gate as agent contributions: the [Check workflow](.github/workflows/check.yml) has to
be green and someone has to review the diff.

## Before you start

- Read the top-level [`CLAUDE.md`](CLAUDE.md) — it is the orientation document for this repo,
  written for AI agents but accurate for humans.
- Read the `AGENTS.md` for the component you are touching. It is not optional; each one
  documents patterns that a reviewer will hold you to:
  - [`app/AGENTS.md`](app/AGENTS.md) — frontend patterns, Zustand stores, Tailwind, routes
  - [`server/AGENTS.md`](server/AGENTS.md) — routes, services, A2A protocol, database
  - [`robot-agent/AGENTS.md`](robot-agent/AGENTS.md) — Genkit tools, robot state, telemetry, simulation
- Get the stack running once: the [Quick Start](README.md#quick-start) in the README. Five
  minutes, SQLite, no Docker.
- Note that three lifecycle stages live in sibling repos (`../vla-server`,
  `../training-worker`, `../twin-builder`, `../sim-trainer`). If your change is about model
  serving or training, it probably belongs there — see the
  [repo map](README.md#repo-map-whats-here-whats-next-door).

## Setup

```bash
git clone https://github.com/RaaSaaR-org/robot-management-system.git
cd robot-management-system
```

Then follow the [Quick Start](README.md#quick-start).

## Picking up work

Work is tracked two ways.

**GitHub issues** — start with a
[`good first issue`](https://github.com/RaaSaaR-org/robot-management-system/labels/good%20first%20issue).
Comment on it before you start so nobody duplicates your work.

**The MissionControl backlog** — the real roadmap lives in `.mc/tasks/` as Markdown files with
YAML frontmatter, split into `todo/`, `done/` and `deferred/`. If you have the `mc` CLI:

```bash
mc task board                 # kanban view
mc task next                  # the next actionable task
mc list tasks                 # everything
mc show TASK-201              # one task in full
mc task move TASK-201 done    # close it
mc new task "Title" --priority 2 --tags core
```

Without `mc`, just read the Markdown in `.mc/tasks/todo/` directly — that is all `mc` does.

Tasks are meant to be **self-contained**: current state, per-component sections with explicit
file paths, and a test strategy. If a task you pick up is not, that is a bug in the task — say
so in the issue or PR rather than guessing.

Tags: `core`, `extended`, `compliance`, plus `deferred` for deprioritized items.

## Branching

Branch from `main`. Use a conventional-commit-style prefix and a short kebab-case description:

```
feat/agent-mode-place-memory
fix/dataset-episode-nested-names
docs/readme-repo-map
chore/tasks-close-201
```

## Commits and PRs

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) with a
scope, matching the existing history:

```
feat(agent-mode): measure range with LiDAR instead of guessing it
fix(server): serve standard LeRobot v2.1 layouts from local-disk datasets
docs(voice): robot-day run sheet
chore(tasks): close TASK-195..200
```

Pull request expectations:

1. **One coherent deliverable per PR.** Bundle closely related follow-up work (for example a
   fix and the UX change it requires); do not bundle unrelated features.
2. **Say what changed and why**, and say what you actually verified. "Typechecks" and "tested
   on real hardware" are very different claims — make the right one.
3. **Commit your `.mc/tasks/` changes on the PR branch**, not afterwards on `main`. If your PR
   closes a task, move the file to `done/` in the same PR.
4. **Update `CHANGELOG.md`** if your change is user-visible. Format is
   [Keep a Changelog](https://keepachangelog.com/), versioning is CalVer with a `v` prefix —
   headings read `## [vYYYY.MM.DD] - YYYY-MM-DD`, and a second release on one day gets a `.1`
   suffix (`v2026.06.21.1`).
5. Link the issue or `TASK-NNN` the PR resolves.

## Testing

Run the full suite before you push:

```bash
./scripts/test-all.sh              # typecheck + unit tests + pytest + playwright
./scripts/test-all.sh --skip-pw    # everything except playwright
```

This is the single documented entry point. It runs typecheck (server, app, robot-agent), vitest
(server, app, robot-agent), the `sim_g1_dds` pytest suite, then the Playwright UI tests. Every
stage runs even when an earlier one fails, so one invocation gives you the whole picture.

The pytest stage needs the cyclonedds + MuJoCo venv described in
`robot-agent/hardware/sim_g1_dds/README.md` — point `SIM_PYTHON` at it. Without that venv the
stage reports **SKIPPED**, never passed. Don't read a skip as a pass.

CI ([`check.yml`](.github/workflows/check.yml)) gates on: server typecheck + vitest + build, app
typecheck + vitest + build in both default and `VITE_DEMO_MODE=true` mode, robot-agent typecheck
+ vitest, and a Postgres job that replays the committed Prisma migrations onto a clean database
and fails on drift from `schema.prisma`. If you changed the schema with `db push` only, add a
catch-up migration — otherwise a production `migrate deploy` produces a database the generated
client does not match.

Add tests with your change. New route → supertest coverage. New service or repository → vitest.
New UI flow → a Playwright spec.

## Code style

Enforced by review and, where possible, by `tsc`:

- **TypeScript strict mode.** No `any`. Explicit types on public APIs.
- **Named exports only.** No default exports, anywhere.
- **A JSDoc file header on every file:**

  ```typescript
  /**
   * @file RobotCard.tsx
   * @description Card component displaying robot status
   * @feature robots
   */
  ```

- **Feature order across the stack:** types → protos (if gRPC) → server (schema, repository,
  service, route) → robot agent → frontend (store, hooks, components, page).
- **Layering:** routes call services, services call repositories. Routes never touch Prisma
  directly.
- **Frontend:** feature-first directories under `app/src/features/`, Zustand for state.
- **German is the project's primary language** for content and documentation aimed at users;
  code, code comments and this repository's English-language docs stay in English.

## Honesty rules

This is the part that matters most, and it is the part reviewers will push back on hardest.
NeoDEM's whole argument is that it reports what it actually knows.

- **Never present a simulated value as a measurement.** If it comes from simulation it gets a
  SIM badge (`app/src/features/robots/components/SimBadge.tsx`).
- **Never substitute a guess for a missing reading.** A missing LiDAR return is `UNKNOWN`, not
  "clear". An unacknowledged stop is `unconfirmed`, not "stopped". An unmapped pose resolves to
  `NULL`, not the last known place.
- **Never claim real-hardware maturity for something proven only in simulation** — not in the
  UI, not in the README, not in a PR description. Say "sim-only" and mean it.
- Anything that touches real robot motion stays behind an explicit gate.

If your change makes the system quieter about its own uncertainty, it will be rejected even if
the code is correct.

## Security

Do not open a public issue for a security problem. Email **info@EmAI.dev** with the details and
give us a chance to ship a fix first.

Never commit secrets. API keys, tokens and robot credentials belong in `.env` files, which are
gitignored — commit the `.env.example` instead.

## Code of conduct

Be respectful and constructive. Assume the person on the other side is trying to build the same
thing you are. We are committed to a welcoming and inclusive experience for everyone.

## License

By contributing you agree that your contribution is licensed under the MIT License, the same
terms as the rest of the project.

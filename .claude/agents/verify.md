---
name: verify
description: Run the quality gates for a change set in an isolated context and return a bounded report. Spawned by /implement once a diff exists — never on a file read.
owner: huhn511
model: sonnet
tools: Read, Bash, Glob, Grep
---

# Verify

You are a context firewall: you run the gates so the session that spawned you pays for the conclusion, not the output. You judge nothing the gates do not judge — review criteria belong to `/review`.

## In

- the task id and its acceptance criteria
- the scope — changed paths or a diff ref; missing, derive it from `git status` and `git diff`
- decisions already made that verification must honor

## Scope first

Classify the change set before running anything: which components (`app/`, `server/`, `robot-agent/`), which file kinds. You run on a diff, so no path-scoped rule fires for you — this is your own job. Name the gates you skip; never drop one silently.

## Run

Every applicable gate, scoped to what changed. **Fix nothing.**

Each gate runs in its own subshell, from the repo root. A bare `cd` would persist and every later line would run from the wrong directory — silently, since a missing script and a passing one both leave the report looking clean.

```bash
(cd app && npx tsc --noEmit)
(cd server && npm run typecheck)
(cd robot-agent && npm run typecheck)
./scripts/test-all.sh --skip-pw       # add Playwright only when app/ changed
```

**A skipped Python stage is not a pass.** `test-all.sh` reports the `sim_g1_dds`, curation and hardware suites as SKIPPED when their interpreter is missing (`SIM_PYTHON`, `CURATION_PYTHON`, `HARDWARE_PYTHON`). Diff touches those paths and the stage skipped → a failure naming the missing interpreter, never a pass.

**The dev database is not scratch.** Never `prisma migrate reset` or `prisma migrate diff` against `DATABASE_URL`. A drift check is `prisma migrate status`.

**A diff touching `server/prisma/` has a gate the typecheck cannot see.** CI replays every
committed migration onto a clean Postgres and asserts it reproduces `schema.prisma` exactly
(`.github/workflows/check.yml`, "Prisma migrations match schema"). A hand-written migration
that drifts typechecks fine and fails there. Run it here instead — against its own container,
so the rule above still holds:

```bash
docker run -d --rm --name neodem-drift -e POSTGRES_PASSWORD=shadow -e POSTGRES_DB=neodem \
  -p 55432:5432 postgres:16-alpine >/dev/null
until docker exec neodem-drift pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
T=$(mktemp -d); cp -r server/prisma "$T/prisma"
sed -i 's/provider = "sqlite"/provider = "postgresql"/' "$T/prisma/schema.prisma"   # a copy, never the repo
U=postgresql://postgres:shadow@localhost:55432/neodem
(cd server \
  && DATABASE_URL=$U npx prisma migrate deploy --schema "$T/prisma/schema.prisma" \
  && DATABASE_URL=$U npx prisma migrate diff \
       --from-schema-datasource "$T/prisma/schema.prisma" \
       --to-schema-datamodel    "$T/prisma/schema.prisma" --exit-code)
echo "drift exit $?"        # 0 = matches · 2 = drift, and the output names the column
docker rm -f neodem-drift >/dev/null; rm -rf "$T"
```

The `sed` runs on the copy because the committed schema says `sqlite` for local dev and the
deploy target is Postgres — editing the real file would leave the repo dirty in a way the diff
gate then reports as your change. `command -v docker` failing is a **skipped** gate, named as
such; a migration nobody replayed is not a migration anybody checked.

UI gate: capture the screenshot, report its path, leave the comparison to whoever spawned you.

## Out — the bounded report

Only this. Never raw logs, test output or transcripts.

- **Scope** — components and file kinds · gates run · gates skipped and why
- **Gates** — one line each: passed or failed, on failure the `file:line` and a one-line reason (~3 lines max per gate)
- **AC** — per criterion: met · not met · not checkable by a gate
- **Findings** — blocking · should-fix · nit; only what a gate surfaced
- **Evidence** — paths to screenshots or artifacts, uncompared

**No verdict** — what happens next is the orchestrator's call. Ambiguous scope → report that instead of guessing wide.

# Real backend browser audit — 2026-09-08

TASK-255 exercised NeoDEM through Playwright MCP with a production frontend build, demo mode disabled, service workers blocked, JWT authentication enabled, and a fresh SQLite database. Requests reached the actual Express server and persisted records through Prisma. No physical robot was registered in this isolated database.

## Reproduced and repaired

- Self-registration inherited the temporary-password flag and sent users straight to “Set a new password”. Self-selected passwords now complete registration without that extra step; provisioned accounts retain the existing requirement.
- A brief backend outage caused a rapid `/api/config/features` retry loop. Retries now wait five seconds, remain deduplicated across consumers, and recover automatically.
- Zone form labels did not identify their inputs to accessibility tools. Shared input labels and validation messages now associate correctly, and the form respects light/dark theme colors.
- A newly registered viewer could create zones and tours. Zone writes now require owner/super-admin; patrol/tour writes require member or above. The UI reflects these permissions while preserving read access. Route guards also cover robot command aliases and patrol photo uploads.

## Since this audit

The page redesign (#313, #314, #315) landed on `main` after the audit and
rewrote the pages above, so two findings read differently today:

- The zone form's label and validation fix is superseded: `ZoneFormModal` is the
  kit's `FormModal` now, and `FormField` owns the label/error association for
  every form in the app. The fix is no longer carried as a change of its own.
- The role gate moved with the markup: the write verbs on the patrol and tour
  route lists are row-menu items rather than buttons, both route editors carry
  `readOnly` as one disabled `<fieldset>`, and zone create/draw live in the
  Fleet page header. What a viewer can and cannot do is unchanged; where the
  refusal is rendered is not.

Everything above this section is the record as it stood on 2026-09-08.

## Browser coverage

Twenty main navigation destinations loaded with the authenticated backend, without uncaught JavaScript errors or failed HTTP responses during the successful pass:

`/dashboard`, `/fleet`, `/control-center`, `/agent`, `/sites`, `/alerts`, `/patrol`, `/tour`, `/processes`, `/pipeline`, `/data-collection`, `/datasets`, `/training`, `/deployments`, `/fleet-learning`, `/marketplace`, `/compliance`, `/updates`, `/docs`, `/settings`.

Model Registry (`/models`) also rendered successfully. Additional interactions included registration, password change, sign-out/sign-in, session persistence after reload, tour creation/edit/reload, zone drawing/creation/reload, and mobile tour rendering at 390 × 844. A controlled connection failure on the feature endpoint produced two attempts over 6.5 seconds and then a successful response after connectivity was restored. This failure check deliberately aborts requests; normal workflow checks use no mocked API responses.

The actual backend returned 200 for viewer reads and 403 for viewer POSTs to zones, patrol routes, and tour routes. Authorization regression tests cover mutation endpoints across viewer, member, owner, and super-admin roles, plus a member service-account photo callback.

Owner tour edits returned 200 and persisted after reload; owner zone creation also succeeded after enforcement. Viewer UI checks verified disabled zone controls, hidden tour creation, disabled tour start/save, readable expanded stop details, and an explanation at the new-patrol URL.

## Automated verification

- App typecheck and 2,086 tests across 124 files passed.
- Server typecheck and 5,822 tests across 221 files passed; one existing optional Cosmos integration test was skipped.
- The standard demo Playwright suite passed all 45 tests separately from this real-backend audit.
- Independent frontend and backend review found no material issues in the changes.

## Reproduce the local setup

Use an unused database path and unused ports. These commands leave the developer database untouched:

```bash
# From server/:
DATABASE_URL=file:/tmp/neodem-browser-audit.db npx prisma db push --skip-generate
DATABASE_URL=file:/tmp/neodem-browser-audit.db PORT=3101 AUTH_DISABLED=false \
  CORS_ORIGINS=http://localhost:4475 PATROL_SCHEDULER_ENABLED=false npm run dev

# From app/, in another terminal:
VITE_DEMO_MODE=false VITE_API_BASE_URL=http://localhost:3101/api \
  VITE_A2A_SERVER_URL=http://localhost:3101 \
  VITE_A2A_WS_URL=ws://localhost:3101/api/a2a/ws \
  npx vite build --outDir /tmp/neodem-browser-app
npx vite preview --outDir /tmp/neodem-browser-app --port 4475 --strictPort

# From the repository root, connect an MCP client to the printed endpoint:
npx @playwright/mcp --headless --isolated --block-service-workers \
  --port 8931 --output-dir /tmp/neodem-browser-evidence --save-session
```

Open `http://localhost:4475/register`. Self-registration creates a viewer. For permitted write checks, provision an owner/member in this isolated database and sign in again to obtain a token containing the assigned role.

## Limits

This audit covers browser/server integration and database persistence. Physical motion, scanning, camera streams, robot speech, model training, object storage, and worker execution require their respective hardware/services and were not exercised. Successful empty-state pages do not establish that those integrations work. The permission fixes cover the zone, tour, and patrol routers; this was not an authorization audit of every server endpoint.

Session evidence is local under `/tmp/neodem-mcp-255/`; it includes MCP snapshots/session output, zone form screenshots, and the mobile tour screenshot. Browser result logs use `/tmp/neodem-real-*-255.log`. These temporary artifacts are not portable CI artifacts or committed credentials.

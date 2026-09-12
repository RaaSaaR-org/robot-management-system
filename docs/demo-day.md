# Demo day rehearsal

Use the browser demo for the presentation fallback. It runs with simulated API responses, needs no backend or robot, and uses the same build flag as GitHub Pages. Live collection, training, deployment and robot motion require a separately rehearsed stack.

## Prepare the fallback

From the repository root:

```bash
cd app
npm ci
VITE_DEMO_MODE=true npm run build
VITE_DEMO_MODE=true npm exec vite -- preview --port 4473 --strictPort
```

Open `http://localhost:4473/robot-management-system/`. Keep this terminal running. Choose another free port if necessary; do not reuse a process whose application you have not checked. Keep the built `app/dist` available on the presentation computer, and load the pages once before relying on an offline presentation. Some embedded or external resources may still need a network connection.

In a separate terminal, run the browser gate on a different free port:

```bash
cd app
npx playwright install chromium
PLAYWRIGHT_PORT=4573 npm run e2e
```

On Linux, use `npx playwright install --with-deps chromium` to install browser system dependencies too.

Playwright owns its build and preview process and stops them after the run. It tests the demo configuration; live-stack and video-recording suites have separate configurations. Avoid rebuilding `app/dist` while presenting from it.

## Rehearse the presentation

1. Open Dashboard and explain that telemetry and robots are simulated browser fixtures.
2. Visit Fleet, Control Center and Agent Mode. Demonstrate only the interactions exercised in the browser rehearsal; simulated completion does not prove physical motion.
3. Open Fleet's Sites tab and Updates, then visit `http://localhost:4473/robot-management-system/#/models` for Model Registry (it has no sidebar entry). Empty states are expected with no scans, update packages or models registered in the demo.
4. Walk through Skill Training and the lifecycle navigation. Backend-dependent pages may show a demo placeholder or prerequisites; do not promise a real training run from this browser build.
5. Return to Dashboard through navigation after each segment. Open Docs for architecture and integration details.

For a backend demonstration, follow the [README quick start](https://github.com/RaaSaaR-org/robot-management-system/blob/main/README.md#quick-start) and verify each worker can claim work before the audience arrives. With authentication enabled, workers use `WORKER_API_TOKEN`; robots use their own `NEODEM_SERVICE_TOKEN` service-account credential. Keep those credentials out of browser build variables and presentation recordings. The advertised robot URL must be reachable from the server, including when they run in separate containers.

Physical G1 motion is a separate rehearsal. Follow the [real G1 runbook](https://github.com/RaaSaaR-org/robot-management-system/blob/main/docs/real-g1-apple-runbook.md) and its existing arming requirements; a passing browser or simulator test is not hardware validation. The [operations runbook](https://github.com/RaaSaaR-org/robot-management-system/blob/main/docs/runbook.md) covers service failures.

## Recover during the presentation

- If the hosted demo is unavailable, open the prepared local preview URL.
- If a demo page fails, reload Dashboard and repeat the navigation once. If it recurs, use the last rehearsed build and record the failing route and browser error for diagnosis.
- If a live worker or robot disconnects, switch to the browser demonstration and identify it as simulated. Check server/agent logs before retrying live operations.
- Restore a known-good version through the normal deployment process; do not reset a database or change robot arming settings as a presentation workaround.

## Before merging and presenting

- Review each focused PR against its task criteria and component guidance.
- Require CI for the actual final commit: server, app, robot agent, migrations, Python and demo browser checks. An absent, pending or skipped required job is not a pass.
- Run the demo browser suite after navigation or mock-contract changes. Review screenshots of affected pages as well as test output.
- Confirm GitHub Pages deployment succeeded after the merge, then exercise the hosted Dashboard → repaired pages → Dashboard flow in a fresh browser session.
- Rehearse the local fallback from the same reviewed commit. Record that commit and any backend/hardware limitations in the presentation notes.

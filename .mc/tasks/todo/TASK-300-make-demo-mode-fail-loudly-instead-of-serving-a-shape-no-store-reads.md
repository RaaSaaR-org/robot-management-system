---
id: "TASK-300"
aliases: []
title: "Make demo mode fail loudly instead of serving a shape no store reads"
slug: "make-demo-mode-fail-loudly-instead-of-serving-a-shape-no-store-reads"
status: "review"
priority: 2
owner: "huhn511"
projects: []
customers: []
tags: [core, app]
sprint: ""
parent: "[[TASK-281]]"
depends_on: []
spe: 5
effort: "medium"
due_date: ""
created: "2026-09-12"
updated: "2026-09-12"
---

# Make demo mode fail loudly instead of serving a shape no store reads

## Description

The MSW demo build answers every unhandled `GET /api/*` with `{data: [], total: 0, items: []}` — an envelope no store reads — so any feature added without a hand-written handler silently gets `undefined` where it expects an array. Replace the catch-all with a loud 404 after giving every endpoint the demo actually calls a real handler, warn on unhandled non-GET (which today escapes to the public internet), and add a top-level error boundary so a thrown render degrades to an error panel instead of a blank tree.

## Details

### Current state

**Read this first — the two pages originally blamed for this are not the symptom.** `/deployments` and `/alerts` → Incidents do **not** white-screen: `app/src/features/deployment/pages/DeploymentsPage.tsx:32` and `app/src/features/incidents/pages/IncidentsPage.tsx:125` return `<DemoFeaturePlaceholder>` before any hook when `VITE_DEMO_MODE === 'true'`, and `AlertsPage.tsx:185` renders that same guarded `IncidentsPage`. Those guards landed in #59 (`bdea0ec6`). `app/e2e/app-routes.spec.ts` covers `/deployments` and `/alerts?tab=incidents` and the suite passes. So `deploymentStore.ts:97` and `incidentsStore.ts:108` are unreachable in the demo build. Do not scope work against them.

**The trap is real and armed elsewhere.** `app/src/mocks/handlers.ts:620` ends the list with `http.get('/api/*', () => HttpResponse.json({ data: [], total: 0, items: [] }))`. 55 store assignments take a response field straight into state (`state.X = response.Y`, no fallback). Two are live in the demo today:

- `app/src/features/command/store/commandStore.ts:144` does `state.history = response.entries`; `/api/command/history` has no handler, `commandApi.ts:224` does not defend, and `useCommand.ts:280` calls `.filter` on that value during render. The only reason the demo survives is that `CommandHistory.tsx` is mounted nowhere.
- `app/src/features/safety/store/safetyStore.ts:109` iterates `status.robots` from the unhandled `GET /api/safety/fleet` — and the dashboard **does** mount `FleetEmergencyStopButton` (`DashboardPage.tsx:82`). It throws inside its own `try` and stores "robots is not iterable" as a fetch error.

**The catch-all covers GET only.** `app/src/main.tsx:45` starts the worker with `onUnhandledRequest: 'bypass'`, so every unhandled POST/PATCH/DELETE leaves the page for the real network — all nine A2A list calls are POSTs (`a2aApi.ts:343` `POST /a2a/task/list`), as is the fleet E-stop and every mutation. On GitHub Pages those hit a 404 HTML page.

Pages that do survive survive by hand-defence in the api layer — `teamApi.ts:30`, `serviceAccountsApi.ts:22`, `organizationsApi.ts:42`, `patrolApi.ts:82`/`:162`, `tourApi.ts:91`/`:150` each `?? []` or `Array.isArray(...)`, several with a comment naming the demo catch-all.

Nothing tests the seam: of 142 test files under `app/src`, none imports `mocks/handlers` or `mocks/server`. The only `ErrorBoundary` in `app/src` is `ViewerGuard.tsx:50` (the 3D canvas), so a thrown render blanks the tree.

### Frontend

Fix in the mock layer — **not** the stores and **not** the api client. Not the stores: 55 sites, each a fresh chance to forget, and a `?? []` there also hides a real contract break in production. Not `app/src/api/client.ts`: it returns `response.data` typed per call site and cannot know which field is the list. `handlers.ts` is the only place that fabricates a shape no server would ever send.

1. **Give every `/api` GET the demo actually issues a real handler**, copying the envelope from each api module's generic type argument (pattern: `handlers.ts:73` `/api/robots`). Missing today, each reachable in the demo:
   - `/api/safety/fleet` → `{ timestamp, robots: [], anyTriggered: false, triggeredCount: 0 }` (`app/src/features/safety/types/safety.types.ts:69`)
   - `/api/safety/robots/:id`
   - `/api/settings` → full `UserSettings` (`app/src/features/settings/types/settings.types.ts:11`)
   - `/api/auth/mfa/status` → `{ mfaEnabled, totpConfigured, hasRecoveryCodes }`
   - `/api/team` → `{ members: [] }`
   - `/api/team/service-accounts` → `{ accounts: [] }`
   - `/api/tenants` → `{ tenants: [] }`, `/api/tenants/current`
   - `/api/patrol/{routes,runs,places,findings}` and `/api/tour/{routes,places,runs}` → bare arrays
   - `/api/command/history` → `{ entries: [], pagination }`
   - `/api/incidents` + `/api/incidents/dashboard`, `/api/deployments`
2. **Replace the catch-all at `handlers.ts:620`**: keep it last, respond **404** with `{ error: 'No demo handler for GET <path>' }` and header `x-msw-unhandled: 1`, plus `console.error` in DEV. Stores then take their existing `catch` → `ErrorState` path instead of storing `undefined`.
3. **`app/src/main.tsx:44-51`**: pass `onUnhandledRequest` as a function — `console.warn` when the url path starts `/api/`, `bypass` otherwise — so escaping POSTs are visible.
4. **Add `RouteErrorBoundary`** (class component, model on `ViewerGuard.tsx:44-62`) rendering `ErrorState` (`app/src/shared/components/ui/ErrorState.tsx`) with a reload action; export it from `app/src/shared/components/ui/index.ts` beside line 73; wrap `{children}` inside `ProtectedAppRoute` in `app/src/App.tsx` (~line 118, inside `<AppLayout>`) so the shell survives a page throw.

**Key files:**
- `app/src/mocks/handlers.ts` — add ~14 endpoint handlers; catch-all returns 404 + `x-msw-unhandled` header
- `app/src/mocks/__tests__/handlers.test.ts` — NEW: `msw/node` `setupServer` over the real api modules
- `app/src/main.tsx` — `onUnhandledRequest` function: warn on `/api`, bypass otherwise
- `app/src/shared/components/ui/RouteErrorBoundary.tsx` — NEW: class boundary rendering `ErrorState`
- `app/src/shared/components/ui/index.ts` — export `RouteErrorBoundary` and its props type
- `app/src/App.tsx` — wrap `ProtectedAppRoute` children in `RouteErrorBoundary`
- `app/e2e/demo-api-contract.spec.ts` — NEW: assert no response carries `x-msw-unhandled`
- `app/src/features/safety/types/safety.types.ts` — read `FleetSafetyStatus` shape for the handler
- `app/src/features/settings/types/settings.types.ts` — read `UserSettings` shape for the handler
- `app/src/features/command/api/commandApi.ts` — read `CommandHistoryResponse` shape for the handler

## Acceptance Criteria

- [ ] `app/src/mocks/handlers.ts` contains no handler returning `{ data: [], total: 0, items: [] }`; the final `http.get('/api/*')` responds with status 404 and the header `x-msw-unhandled: 1`.
- [ ] `app/src/mocks/__tests__/handlers.test.ts` runs the real `safetyApi.getFleetSafetyStatus`, `commandApi.getHistory`, `teamApi.list`, `organizationsApi.list`, `patrolApi.listRoutes`, `tourApi.listRuns`, `settingsApi.getSettings` and `authApi.getMfaStatus` against `setupServer(...handlers)` with no `vi.mock`, and asserts each returns the documented shape (arrays are arrays).
- [ ] Deleting any one of those handlers makes that new vitest spec fail rather than pass with an empty list.
- [ ] `app/e2e/demo-api-contract.spec.ts` visits **the routes reachable from the demo navigation** and fails if any response carries `x-msw-unhandled: 1` or any `pageerror` fires. (Scoped deliberately — see Notes.)
- [ ] A component that throws during render inside `ProtectedAppRoute` shows the `ErrorState` panel with the app shell still mounted, covered by a vitest test for `RouteErrorBoundary`.
- [ ] `cd app && npx vitest run` and `cd app && npx playwright test` both pass, and `npx tsc` is clean.
- [ ] `git diff --name-only main` lists no file under `app/src/components/layout/` or `app/src/components/docs/`.

## Test Strategy

The seam is mocked in five places, all of them a `vi.mock` of the api module the store calls: `app/src/features/deployment/store/__tests__/deploymentStore.test.ts:26` (`vi.mock('../../api')`), `app/src/features/incidents/store/__tests__/incidentsStore.test.ts:31`, `app/src/features/safety/store/__tests__/safetyStore.test.ts:27`, `app/src/features/command/store/__tests__/commandStore.test.ts:26` and `app/src/features/alerts/store/__tests__/alertsStore.test.ts:30`. Each feeds the store a hand-written well-formed response (`deploymentStore.test.ts:121` `api.listDeployments.mockResolvedValue({ deployments: [...] })`), so the store is only ever tested against a payload the demo never produces. Worse, **the fabricating layer itself has zero coverage**: no test under `app/src` imports `mocks/handlers` or `mocks/server`, and `app/src/test/setup.ts` wires no MSW server.

Replacement, both without mocks at the broken boundary:

1. **`app/src/mocks/__tests__/handlers.test.ts`** — `setupServer(...handlers)` from `msw/node` (msw ^2.12.10 is already a devDependency), `beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))`, then call the **real** api modules through the real axios client and assert the shape each store relies on. One case per endpoint listed above, plus a case asserting an unknown path (`/api/not-a-real-endpoint`) rejects with status 404 rather than resolving. Keep this `setupServer` **file-local** — see Notes.
2. **`app/e2e/demo-api-contract.spec.ts`** — over the demo-nav-reachable route list, register `page.on('response', ...)`, collect any response whose headers carry `x-msw-unhandled`, and assert the collection is empty alongside the existing no-`pageerror` assertion. This is what the current specs cannot catch: `demo-smoke.spec.ts:19` and `app-routes.spec.ts:96` both assert only that the page did not crash, so an endpoint answered with a nonsense envelope passes them today.

Leave the five store tests as they are — they cover store logic correctly; they simply cannot cover the mock contract.

## Notes

**The e2e criterion is deliberately narrowed to routes reachable from the demo navigation, not "every route in the demo build".** The catch-all at `handlers.ts:620` is GET-only and `main.tsx:45` bypasses unhandled writes entirely, so a sweep of every route would surface considerably more than the ~14 handlers this task budgets for. If the narrowed run still turns up unhandled endpoints beyond that list, file them as a follow-up rather than growing this task past its size.

**Boundary placement.** The `RouteErrorBoundary` goes in `app/src/App.tsx` (`ProtectedAppRoute`, ~line 118) and a new file under `app/src/shared/components/ui/` — deliberately **NOT** `app/src/components/layout/**`, which the parallel navigation session owns (TASK-273..280), along with `app/src/components/docs/DocsSidebar.tsx`. If review asks for the boundary inside `AppLayout` instead, raise it with that session rather than editing there.

**msw wiring is owned elsewhere.** TASK-296 owns the global msw wiring in `app/src/test/setup.ts`. This task keeps its `setupServer` file-local to `handlers.test.ts` and **must not edit `app/src/test/setup.ts`** — many existing suites mock `apiClient`, and a global `onUnhandledRequest` setting would break them.

`app/e2e/app-routes.spec.ts:18` holds the canonical route list as a private const. Either duplicate it in the new spec or lift it to `app/e2e/helpers/routes.ts` and import from both — that helper file is not owned by the navigation session.

`playwright.config.ts` builds the demo app and serves it itself, so the e2e gate takes minutes; run `npx vitest run` first. `PLAYWRIGHT_PORT` may need overriding if 4173 is occupied by a foreign preview.

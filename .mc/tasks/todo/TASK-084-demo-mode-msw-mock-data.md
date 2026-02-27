# TASK-084 — Demo Mode: MSW Mock Data + H1 Fleet

## Status: todo
## Priority: high
## Component: app

---

## Ziel

Die App im Demo Mode (`VITE_DEMO_MODE=true`) zeigt realistische Mock-Daten über MSW (Mock Service Worker) ohne Verbindung zu einem echten Backend. H1 Humanoid ist der Haupt-Demo-Robot.

## Scope

### Neue Files

1. **`app/src/mocks/demoData.ts`** — H1 Robot (19 DOFs), Fleet von 5 Robots (H1, SO-101, G1, H1-B charging, Generic offline), Telemetrie, Alerts, Zones
2. **`app/src/mocks/browser.ts`** — MSW Browser Worker Setup (`setupWorker(...handlers)`)
3. **`app/public/mockServiceWorker.js`** — via `npx msw init public/ --save`

### Geänderte Files

4. **`app/src/mocks/handlers.ts`** — Erweitern um alle Demo-Endpoints:
   - `GET /api/robots` → DEMO_ROBOTS Array
   - `GET /api/robots/:id` → Single Robot (inkl. H1 mit 19 Joint States)
   - `GET /api/robots/:id/telemetry` → DEMO_H1_TELEMETRY
   - `POST /api/robots/:id/command` → 200 OK
   - `GET /api/alerts` + `/api/alerts/active` + `/api/alerts/counts` → 3 Demo-Alerts (critical/warning/info)
   - `GET /api/zones` → 4 Zonen (Assembly Hall, Lab Bench A, Corridor B, Charging Station)
   - `GET /api/auth/me` → MOCK_USER (Admin)
   - `POST /api/auth/login` + `/api/auth/refresh` → Tokens
   - Catch-all: alle anderen `GET /api/*` → leere Listen

5. **`app/src/main.tsx`** — Demo Mode Init:
   - HashRouter statt BrowserRouter wenn `VITE_DEMO_MODE === 'true'`
   - Conditional MSW-Start: `await import('./mocks/browser')` → `worker.start()`
   - Service Worker URL: `${import.meta.env.BASE_URL}mockServiceWorker.js`

6. **`app/vite.config.ts`** — Base Path:
   ```ts
   base: process.env.VITE_DEMO_MODE === 'true' ? '/robot-management-system/' : '/'
   ```

7. **`app/src/app/providers/AuthProvider.tsx`** — devLogin auch im Demo Mode:
   ```ts
   if (import.meta.env.DEV || import.meta.env.VITE_DEMO_MODE === 'true') {
     devLogin(MOCK_USER);
   }
   ```

8. **WebSocket graceful skip** — In WebSocket-Connect-Logic: Skip wenn `VITE_DEMO_MODE === 'true'`

### H1 Mock Data (Spec)

```
H1 "Atlas H1": status=online, battery=78%, 19 Joint States, location=Assembly Hall
SO-101 "Arm SO-101": status=busy, battery=null (AC-powered), task=Pick&Place
G1 "Scout G1": status=online, battery=92%, floor 2
H1-B "Titan H1-B": status=charging, battery=23%
Generic "Patrol Bot": status=offline, battery=5%
```

3 Alerts: 1 critical (H1 temp warning), 1 warning (SO-101 joint limit), 1 info (G1 route complete)

## Test (lokal)

```bash
cd app && VITE_DEMO_MODE=true npm run build && npm run preview
# Browser: http://localhost:4173/robot-management-system/
# → Landing Page → Dashboard → 5 Robots → H1 Detail mit Telemetrie
```

## Deliverable

- PR auf `feat/TASK-084-demo-mode`
- `/tmp/devin-result.md` mit Build-Output + Ergebnis
- Kein `VITE_DEMO_MODE` im normalen `npm run dev` oder `npm run build`

## Referenz

Vollständige Spec in `/tmp/kai-demo-research.md`

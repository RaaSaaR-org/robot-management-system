# TASK-086 — Playwright Screenshot Suite (Dark Mode)

## Status: todo
## Priority: medium
## Component: e2e
## Blocked-by: TASK-084

---

## Ziel

Standalone Playwright-Setup (kein MCP!) das die Demo-App baut, im Dark Mode Screenshots von allen wichtigen Seiten macht und die Bilder speichert — für Landing Page Marketing-Assets und Docs-Einbindung.

## Scope

### Neue Files

1. **`app/playwright.config.ts`**:

```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/results',
  reporter: [['html', { outputFolder: 'e2e/report' }]],

  use: {
    baseURL: 'http://localhost:4173',
    screenshot: 'on',
    viewport: { width: 1440, height: 900 },
    colorScheme: 'dark',
  },

  webServer: {
    command: 'VITE_DEMO_MODE=true npm run build && npm run preview -- --port 4173',
    port: 4173,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },

  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
});
```

2. **`app/e2e/screenshots/demo-pages.spec.ts`** — Screenshots von:
   - `landing` → `/#/` (Full Page)
   - `dashboard` → `/#/dashboard`
   - `robots-list` → `/#/robots`
   - `robot-h1-detail` → `/#/robots/demo-h1-001`
   - `fleet-map` → `/#/fleet`
   - `alerts` → `/#/alerts`
   - `docs` → `/#/docs`
   - Mobile Varianten (390x844) für alle Pages

   Output: `app/e2e/results/screenshots/{name}.png` und `{name}-mobile.png`

3. **`app/e2e/helpers/waitForDemo.ts`** — Helper der wartet bis MSW bereit ist und Demo-Daten geladen sind

4. **`.github/workflows/screenshots.yml`** — `workflow_dispatch` only (nicht bei jedem Push):
   ```yaml
   name: Capture Demo Screenshots & Videos
   on:
     workflow_dispatch:
   ```
   Artifacts: `demo-screenshots` (png files)

### package.json Script

```json
"e2e:screenshots": "npx playwright test e2e/screenshots",
"e2e:videos": "npx playwright test e2e/videos"
```

## Deliverable

- PR auf `feat/TASK-086-playwright-screenshots`
- Lokaler Run erfolgreich: `cd app && VITE_DEMO_MODE=true npx playwright test e2e/screenshots`
- Screenshots landen in `app/e2e/results/screenshots/`
- `/tmp/devin-result.md`

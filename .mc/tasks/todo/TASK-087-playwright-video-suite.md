# TASK-087 — Playwright Video Suite (User Flows)

## Status: todo
## Priority: medium
## Component: e2e
## Blocked-by: TASK-086

---

## Ziel

Playwright-Video-Aufnahmen von typischen User-Flows in der Demo-App (Dark Mode). Videos für Marketing, Docs und GitHub README.

## Scope

### Neue Files

1. **`app/e2e/videos/demo-walkthrough.spec.ts`** — Flows:

   **Flow 1: "Platform Overview"** (~90s)
   - Landing Page (2s) → Dashboard (5s) → Fleet Map (5s) → Alerts (3s)

   **Flow 2: "Robot Command & Control"** (~60s)
   - Robots List → Klick auf H1 → Detail mit Joint States → Telemetrie → Send Command

   **Flow 3: "Fleet at a Glance"** (~30s)
   - Dashboard mit 5 Robots → Status Badges → Battery Levels → Active Tasks

2. **`app/e2e/videos/helpers/smoothNavigate.ts`** — Helper für smooth page transitions (waitForLoadState + 1s settle)

### playwright.config.ts Update

```typescript
use: {
  video: {
    mode: 'on',
    size: { width: 1440, height: 900 },
  },
}
```

Separate Config für Videos: `app/playwright.videos.config.ts` (höhere Timeouts, retries: 0)

### ffmpeg Post-Processing

```bash
# Nach Video-Capture: webm → mp4
for f in app/e2e/results/videos/**/*.webm; do
  ffmpeg -i "$f" -c:v libx264 -crf 23 -preset fast "${f%.webm}.mp4"
done
```

Script: `app/e2e/scripts/convert-videos.sh`

### CI Update (in screenshots.yml)

Artifacts erweitern um Videos: `demo-videos` (mp4 + webm)

## Deliverable

- PR auf `feat/TASK-087-playwright-videos`
- Lokaler Run erfolgreich, mindestens Flow 1 + Flow 2 aufgenommen
- Webm-Output in `app/e2e/results/videos/`
- `/tmp/devin-result.md`

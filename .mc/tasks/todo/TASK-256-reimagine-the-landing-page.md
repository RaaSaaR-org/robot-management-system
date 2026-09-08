---
id: "TASK-256"
title: "Reimagine the landing page"
slug: "reimagine-the-landing-page"
status: "in-progress"
priority: 2
owner: "huhn511"
tags: [design, landing]
spe: 5
created: "2026-09-08"
updated: "2026-09-08"
---

# Reimagine the landing page

Give the public page a memorable hero and clearer content that explains the full Physical AI lifecycle. Use an interactive, native illustration with an explicit illustrative label; preserve feature maturity and safety disclosures.

## Acceptance Criteria
- [x] Distinctive responsive hero with useful interaction and clear calls to action.
- [x] Benefit-led content covering the full lifecycle and self-hosting.
- [x] Keyboard access, reduced motion, light/dark themes and mobile layout verified in a browser.
- [x] Frontend build and relevant regression checks pass.

## Verification

- Frontend build and typecheck passed; 2,074 unit tests passed across 123 files.
- Standard demo Playwright suite: 45 passed.
- Playwright MCP: 320, 390, 768, 1024 and 1440px without overflow; light/dark screenshots reviewed; stage selection by click and keyboard; pause and reduced motion; mobile menu Escape; section navigation. No page errors during the landing checks.
- The safety replay link uses the existing HashRouter-safe scroll helper following independent review.
- Local visual evidence: `/tmp/landing256-desktop.png`, `/tmp/landing256-dark.png`, `/tmp/landing256-mobile-top.png`, `/tmp/landing256-mobile-workflow.png`.
- Gate logs: `/tmp/task256-verify-build.log`, `/tmp/task256-verify-unit.log`, `/tmp/task256-verify-demo.log`.
- No backend, hardware or dependency changes.
- Final rebuilt production demo: safety link preserves HashRouter route and moves focus; primary CTA opens dashboard. Verified with a separate Playwright browser because the existing MCP session intentionally blocks service workers required by the demo.

---
id: "TASK-258"
title: "Create a cinematic Three.js hero"
slug: "create-a-cinematic-threejs-hero"
status: "done"
priority: 3
owner: "huhn511"
tags: [landing, design]
spe: 3
created: "2026-09-09"
updated: "2026-09-09"
---

# Create a cinematic Three.js hero

Replace the landing hero illustration with a professional, cinematic Three.js background related to the complete Physical AI platform. Keep the stacked solid-white headline, with clearer platform positioning. Preserve the unified dark/mint brand and CPU atom identity. Protect unrelated session work using an isolated checkout.

## Acceptance Criteria
- [x] Stacked headline clearly positions the Physical AI platform, without a text gradient.
- [x] Actual Three.js scene uses a CPU core, orbital data paths and multiple embodiments, with ambient motion and subtle pointer response.
- [x] Desktop and mobile keep copy readable and links operable without horizontal overflow.
- [x] Reduced motion, hidden/offscreen suspension, WebGL fallback and GPU cleanup are handled.
- [x] App build, landing tests and Playwright browser validation pass.

- [x] Remove the floating hero caption/info box as requested before shipping.

## Verification

- App production build (TypeScript + Vite) passed; 11 existing landing tests passed.
- Playwright MCP production preview: 320, 390, 768, 1024 and 1440px without overflow; final desktop/mobile screenshots personally reviewed.
- Instrumented WebGL draw calls confirm animation, reduced-motion freeze, offscreen suspension and resume. Context loss shows fallback and restoration resumes rendering. Unsupported WebGL retains static CPU atom. Direct engine teardown confirms lost context and removed canvas. Embodied Loop anchor retains focus behavior.
- Evidence: `/tmp/task258-final-build.log`, `/tmp/task258-final-tests.log`, `/tmp/hero-three-final-1440.png`, `/tmp/hero-three-final-390.png`; browser scripts `/tmp/neodem-mcp-255/hero-three-lifecycle.js` and `/tmp/neodem-mcp-255/hero-three-final.js`.
- Implemented in `/tmp/neodem-hero-three`, separate from the other session's dirty primary checkout. No dependencies added. Standalone production preview on port 4494.
- Unrelated backend/robot/Python suites skipped. Full app authentication and Docs flows are outside this decorative hero slice; the standalone preview has no configured authenticated backend.

## Review

PR #303 opened after clean review of `14768a61..a9bdbaab`. Caption and its CSS removed. Final production build passed after removal.

## Shipping

All six CI gates passed on `88d69edd`. Final caption removal verified in production at 390px and 1440px with no page errors or overflow (`/tmp/task258-ship-390.png`, `/tmp/task258-ship-1440.png`). Task closure rides in PR #303; merge waits for all checks on this final commit. No parent task.

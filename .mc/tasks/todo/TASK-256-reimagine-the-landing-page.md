---
id: "TASK-256"
title: "Reimagine the landing page"
slug: "reimagine-the-landing-page"
status: "review"
priority: 2
owner: "huhn511"
tags: [design, landing]
spe: 5
created: "2026-09-08"
updated: "2026-09-09"
---

# Reimagine the landing page

Give the public page a memorable hero and clearer content that explains the full Physical AI lifecycle. Use an animated native illustration with an explicit illustrative label; preserve feature maturity and safety disclosures.

## Acceptance Criteria
- [x] Distinctive responsive hero with animated illustration and clear calls to action.
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

PR: https://github.com/RaaSaaR-org/robot-management-system/pull/302

## Design revision — 9 September 2026

User feedback: move the humanoid into the protective-stop evidence section, broaden the hero to drones, wheeled robots, quadrupeds (robot dogs), and humanoids, and make the full lifecycle the flagship “Embodied Loop.” The hero uses an interactive shared intelligence field; robot classes illustrate the architecture, not universal integration readiness.

- [x] Revised hero and safety exhibit verified at mobile and desktop widths.
- [x] Embodied Loop stage interactions, navigation and reduced motion verified.
- [x] Revision build and relevant regression checks pass.

Revision evidence: frontend build/typecheck passed; 2,070 unit tests across 123 files and 45 demo browser tests passed. Seven obsolete infinity-path tests were replaced by three circle geometry/interaction tests. Final demo build and scoped lifecycle tests passed after fixing decorative SVG pointer interception on the loop pause control.

Playwright MCP verified all four hero forms, all six loop stages, keyboard activation, section-link focus, both pause controls and reduced motion. No page errors and no horizontal overflow at 320, 390, 768, 1024 and 1440px. Light/dark and mobile screenshots reviewed, including the stationary humanoid beside the simulation readout. Evidence: `/tmp/landing256-revision-{hero,mobile,small-loop,safety-exhibit,dark}.png`; gate logs `/tmp/task256-revision-*.log`.

Review: current branch against merge-base with main, plus the revision working diff; all acceptance criteria met in HeroSection, FullCircleSection, SafetyRobotScene and LandingPage. No outstanding concrete findings.

## Hero refinement — 9 September 2026

Replaced the centered gradient heading and interactive form selector with solid white typography on the left and an automatically animated illustration on the right. Detailed native vector art depicts a drone, wheeled robot and quadruped (robot dog) around a shared intelligence core. Illustration controls are removed; the entrance sequence settles within five seconds and respects reduced motion. Mobile stacks the scene below the copy. Main page navigation links remain.

Verification: app build/typecheck and 11 landing unit tests passed. Playwright MCP checked 320, 390, 768, 1024 and 1440px without overflow, solid heading color, zero illustration buttons, desktop right-side placement, reduced motion, completed animations and lifecycle section-link focus. No page errors. Desktop/mobile and both themes visually reviewed. Evidence: `/tmp/hero-split-desktop.png`, `/tmp/hero-split-mobile.png`, `/tmp/hero-split-final-light.png`; gate logs `/tmp/task256-hero-split-{build,unit}.log`. Earlier full-suite results above predate this presentation-only refinement.

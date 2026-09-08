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

## Humanoid fleet and ambient motion — 9 September 2026

Added three humanoids in formation to the hero concept, with a connection to the shared intelligence core. After the entrance, drone hovering and rotor motion continue, data signals circulate, the core light gently pulses, and staggered humanoid idle/head motion keeps the scene alive. No illustration buttons were added. Reduced motion disables every animation.

Playwright MCP confirmed three humanoids, ongoing motion after seven seconds, zero illustration buttons, zero animations with reduced motion, and no overflow at 320, 390, 768, 1024 and 1440px. Desktop and mobile screenshots visually reviewed: `/tmp/hero-fleet-desktop.png`, `/tmp/hero-fleet-mobile.png`.

Final fleet revision gates: frontend build/typecheck and 11 landing tests passed; diff check clean. Logs: `/tmp/task256-fleet-{build,tests,diff}.log`.

## Leg alignment and infinity redesign — 9 September 2026

User requested corrected robot legs and a true horizontal figure-eight for the Embodied Loop. Humanoid legs now use aligned thigh/calf shells, visible round knee joints and flat feet. Upper-body idle movement pivots around the pelvis so the legs stay planted; quadruped leg angles are gentler.

The lifecycle revision replaces the circular orbit with a horizontal infinity path while preserving all six stages, evidence/readiness disclosures, section navigation and animation controls.

Verification: build/typecheck and 11 landing tests passed. Playwright MCP verified all six stage selections, keyboard Enter, pause, reduced motion, section-link focus, and 320–1440px layouts without overflow or undersized stage targets. Corrected legs and infinity artwork reviewed in screenshots, including 320px mobile. Evidence: `/tmp/hero-legs-fixed.png`, `/tmp/infinity-desktop.png`, `/tmp/infinity-mobile.png`, `/tmp/infinity-final-polished.png`, `/tmp/infinity-final-320.png`. Logs: `/tmp/task256-infinity-verify-{build,tests}.log`. The crossover shadow received a final cosmetic shortening after these tests.

Final build/typecheck and diff check also passed after the crossover polish.

## Loop placement — 9 September 2026

Placed the infinity illustration on the left and the single-column stage details on the right at desktop widths, with stacked content below 1024px. Sized stage nodes and lobe labels for the narrower illustration. Frontend build/typecheck and diff check passed. Playwright MCP confirmed placement at 1024/1440px, stacking at 320/390/768px, no horizontal overflow, and stage selection. Evidence: `/tmp/loop-split-1440.png`, `/tmp/loop-split-390.png`; build log `/tmp/task256-loop-split-build.log`.

## Platform introduction — 9 September 2026

Added “A home for Physical AI” between hero and Embodied Loop. Defines the open all-in-one platform, illustrates data/models/workflows/fleet connecting in one workspace, and introduces the expert-led AI-agent maintenance fleet. Discovery links lead into the lifecycle. Responsive native artwork respects reduced motion and labels hardware integration readiness.

Verification: frontend build/typecheck, 11 existing landing tests and diff check passed. Playwright MCP verified 320–1440px without overflow, discovery-link focus, reduced motion and no page errors. Desktop/mobile screenshots reviewed: `/tmp/platform-1440.png`, `/tmp/platform-390.png`. Logs: `/tmp/task256-platform-build.log`, `/tmp/task256-platform-tests.log`.

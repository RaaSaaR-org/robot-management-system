# Changelog

All notable changes to NeoDEM are documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/). Versioning uses [CalVer](https://calver.org/) (`YYYY.MM.DD`) for daily releases.

## [v2026.06.21.1] - 2026-06-21

### Fixed

- make releases actually build images + repair robot-agent image (#141)

### Maintenance

- release-please-style Release PR flow (keeping CalVer) (#143)
- add Unitree G1 EDU to the robot integration guide (#142)


## [v2026.06.21] - 2026-06-21

### Added

- G1 EDU (Dex3-1) embodiment + interactive episode curation GUI (#138)

### Maintenance

- CalVer release automation + deploy quickstart (#140)
- reframe NeoDEM as full-lifecycle Physical AI platform in CLAUDE.md (#139)


## [v2026.04.12] - 2026-04-12

### Added
- Per-tenant branding: edit modal, logo display, brand color picker (TASK-161)
- `PATCH /api/tenants/:id` endpoint for branding updates (TASK-161)
- Frontend types, API client, and store for tenant branding updates (TASK-161)
- Onboarding wizard for new organizations (TASK-160)
- Impersonation banner below TopBar for tenant admin context (TASK-160)
- Compliance logging for tenant impersonation events (TASK-160)

### Fixed
- Apply brand color to card icon and TopBar pill (TASK-161)

## [v0.1.0] - 2026-04-12

Major milestone release — 354 commits since v0.0.2. NeoDEM is now a multi-repo platform with multi-tenancy, production hardening, and a complete VLA training pipeline.

### Added

#### Multi-tenancy & Security
- Row-level multi-tenancy with Organizations UI, tenant badge, and flag-gated isolation (#122, #124)
- Prisma extension for automatic tenant scoping + cross-tenant test suite (#130)
- Multi-tenancy Waves 3a-3e: tenant-scoped Alert, Incident, RobotTask, RobotCommand, ApiToken, and 10+ remaining models
- Service accounts + API tokens for AI agents and CI/CD (TASK-165)
- Unified role model + /register lockdown (TASK-162, #126)
- Team management page + direct add-user flow (TASK-163, #127)
- Login UX polish + force-password-change flow (TASK-164, #128)
- Onboarding wizard for new organizations + tenant impersonation with compliance logging (TASK-160)
- Security hardening: org switcher, user menu, team table, nav refactor (#129)

#### VLA & Training Pipeline
- VLA UI + DB integration: VlaSession model, proxy routes, VlaControlSection (#66)
- LeRobot v0.5.0 RTC support + SO-101 migration prep (TASK-088, #70)
- Hardware backends plugin system: VLABackend ABC + SmolVLA HTTP backend (TASK-079, #72)
- Sidecar migration to LeRobot v0.5.0 API (#71)
- HTTP-polling training worker + claim endpoint (TASK-136, #101)
- Real SmolVLA LoRA trainer (TASK-136 Phase 1b, #105)
- Dataset stats worker + GPU availability config (TASK-137, #108)
- E2E pipeline test + VLA adapter loading (TASK-141, #109)
- SO-101 data collection pipeline (#107)
- Data Collection UX redesign (TASK-135, #106)
- Dedicated SO-101 record route + keyboard/gamepad fallback (TASK-117, #125)
- VLA server and training worker extracted to separate repos (TASK-150)

#### Data & Datasets
- HuggingFace dataset import backend with 4-phase pipeline (TASK-107, #80)
- HuggingFace Dataset Browser Frontend (#81)
- Dataset Episode Viewer with video playback and joint state charts (#82)
- Featured Datasets tab (SO-101, G1/Dex3, ALOHA, PushT) (#83)
- Push datasets to HuggingFace Hub (TASK-115, #87)
- Auto-create Dataset record on teleop export (TASK-116, #86)
- Episodes redesign with real Parquet data and video fixes (#110)

#### Simulation & Evaluation
- MuJoCo closed-loop VLA evaluation + simulation UI redesign
- Visual simulation: MuJoCo frame capture + episode replay UI
- Persist simulation jobs to database (TASK-132, #96)
- Educational UX overhaul for simulation (TASK-133, #97)

#### Platform & Infrastructure
- OpenRouter provider + A2A request loop fixes (#94)
- Server-side orchestrator LLM (TASK-129, #95)
- Orchestration timeline with live agent routing transparency
- Persistent orchestration chain with timing + agent details
- Production hardening: rate limiting, structured logging, metrics, security headers (TASK-138, #111)
- Production deployment docs, runbook, .env.example refresh (TASK-139, #112)
- White-label branding system
- Health endpoint: version, startedAt, uptimeSeconds, nodeVersion, environment (TASK-122–125)
- Replace dataset-CRUD smoke test with typecheck + build gate (#120)
- Unified Train-a-Skill workflow + cross-page connective tissue (TASK-134, #99)
- Consolidated sidebar: 25→14 items, deleted MLflow (TASK-147, #117)
- Replace fake GPU panel with real worker status (TASK-145, #118)
- Skill & Data Marketplace UI prototype

#### Demo & Docs
- MSW demo mode with H1 fleet and mock data (TASK-084, #53)
- GitHub Pages CI/CD (TASK-085, #54)
- Playwright screenshot suite (14 screenshots, dark mode) (TASK-086, #55)
- Playwright video suite: 3 user flows (TASK-087, #56)
- Dashboard wow-effect + docs redesign with categories (#60)
- Docs viewer with markdown rendering and sidebar (#52)

### Fixed
- Mobile E-Stop button visibility + info banner WCAG contrast (#90)
- DataCollectionPage infinite re-render from selector (#89)
- Dataset status badges + DataCollection routing (#88)
- HF import FK constraint: fuzzy-match robotTypeId with auto-create (#85)
- UX critical fixes: Quality Score 7000%→70%, duration rounding, Episode Viewer 500-errors (#84)
- Keyboard teleop velocity mode (hold-to-move) (#113)
- GPU panel NaN utilization (#92)
- VLA server gRPC→HTTP migration
- Orchestrator agent routing name matching
- Mobile dashboard header overflow + docs table scroll (#102)
- Per-robot state file for multi-instance support
- Dark theme consistency, CTA visibility, WCAG contrast, touch targets (#95–104)

### Changed
- Renamed RoboMindOS → NeoDEM across entire codebase
- Episodes modal replaced with dedicated detail page (TASK-126)
- Robot Detail Page redesigned with Future Tasks UI (TASK-127)
- Pipeline/Skills/Processes consolidated into Skill Training/Library/Automations (TASK-143, #114)
- Evaluation empty state polished (TASK-144, #119)

## [v0.0.2] - 2026-01-10

Initial tagged release.

## [v0.0.1] - 2026-01-09

First release.

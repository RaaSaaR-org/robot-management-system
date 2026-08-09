# Changelog

All notable changes to NeoDEM are documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/). Versioning uses [CalVer](https://calver.org/) (`YYYY.MM.DD`) for daily releases.

## [v2026.08.09] - 2026-08-09

### Added

- one LLM interface for the server, so it can run on local Ollama (#218)
- the robot as a persistent agent — place, memory, identity, heartbeat, geofence + a cockpit you can read (#216)
- speak with the robot - spoken commands drive Agent Mode (#215)
- measure range with LiDAR instead of guessing it (#214)
- real-to-sim realism pass + hold the real leg pose (#213)
- local LLM commands the G1 EDU via LocoClient blocks (TASK-194) (#212)
- NVIDIA GR00T apple-to-plate use case - sim env, server wiring, gated real-G1 bridge (#211)
- G1+Dex3 pick-and-place environment - real GR00T VLA rollouts end to end (#210)
- video-to-G1 motion mirroring (TASK-193) + review hardening (#205)
- voice mode frontend — type-to-speak, live mic transcripts, pipeline controls (TASK-192) (#203)
- real-time 3D robot view — 10 Hz fast channel + damped interpolation (TASK-191) (#202)

### Fixed

- QA-sweep findings - 43-issue cleanup across server, robot-agent, and app (#208)

### Maintenance

- close TASK-195..200 and file what the live warehouse run found (#217)
- close TASK-172 - stub VLA G1-capable + deploy gate exercised at runtime (#209)
- TASK-189 done - closed-loop eval harness (n=40, automation, honesty controls) (#207)
- robot-day run sheet - NeoDEM Voice tab leg (TASK-181/192) (#204)
- TASK-193 review to done - merged as PR #205 (#206)
- TASK-190 — MID-360 frame orientation per scan session (#200)


## [v2026.07.17] - 2026-07-17

### Added

- robot-day tooling for TASK-181 + real-robot speaker validation (#197)
- neural-trajectory synthetic generator mode (TASK-182) (#196)
- whole-RMS real-data flow — all G1 EDU + Dex3 sensors end-to-end, telemetry persistence, SIM-honesty labels (TASK-184) (#195)
- VR teleop sessions record in simulation — sim frame recorder, episodes, live progress (#193)
- TASK-168 - RustFS dataset revisions, video-aware trim/delete, stats recompute, v3 lerobot backend, AI suggestions, Playwright coverage (#189)
- thinking filler, quiet HTTP disconnects, software wake phrase (#187)
- platform hardening, twin point-cloud import, local Ollama LLM, voice interaction service (#185)
- LeRobot 0.6.0 adoption — reward models, rollout strategies, annotations, GR00T N1.7 (TASK-179) (#182)
- lab bringup for real G1 EDU + Dex3 hardware (TASK-169) (#181)

### Fixed

- serve standard LeRobot v2.1 layouts from local-disk datasets (#192)
- recognize Windows absolute paths in isLocalDataset (#191)
- resolve 9 bugs from #186 review + filler reply-drop from #187 (#188)
- platform hardening from production-like full-stack E2E sweep (RustFS+NATS, real GR00T training) (#184)
- handle nested Unitree action.names in DatasetEpisodesPage (#183)
- import all files in multi-file LeRobot v3.0 chunks (#179)

### Maintenance

- VR teleop data-collection guide + TASK-169 robot-day update (#194)
- task triage + runtime-validation notes, 2026-07-11 dz-226 session (#190)


## [v2026.07.04] - 2026-07-04

### Added

- G1 locomotion sim-to-sim gate + Isaac trainer label UX (#178)
- make the Skill & Data Marketplace real (TASK-156) (#176)

### Fixed

- catch-up migration for db-push-only column/index/FK drift (#174) (#175)


## [v2026.06.30] - 2026-06-30

### Added

- Cosmos-3 synthetic data + G1 Control Center cockpit + G1 safety hardening (#170)

### Fixed

- fail fast on the public compliance encryption key (#173)
- rootless nginx image + deployment-agnostic API upstream (#172)
- add catch-up migration for 17 db-push-only tables (#165)


## [v2026.06.27] - 2026-06-27

### Added

- G1 room scan → twin → MuJoCo sim → RL nav-policy (TASK-170/171/172.C) (#164)
- simplify robot detail view + polish VR teleop (#145)

### Fixed

- unshadow static GET routes hidden behind /:id (#158)

### Maintenance

- jobs + workers + websocket coverage — wave 13 (125 tests) (#163)
- unit tests for storage + messaging modules (wave 12) (#162)
- unit tests for cross-cutting modules — utils, security, middleware (wave 11) (#161)
- unit tests for final 9 repository data-access classes (wave 10) (#160)
- unit tests for 10 repository data-access classes (wave 9) (#159)
- cover final 14 route modules via supertest (wave 8) (#157)
- cover 15 more route modules via supertest (wave 7) (#156)
- cover 15 route modules via supertest (wave 6) (#155)
- cover final 5 services — completes service tier (wave 5) (#154)
- cover ML/training-tier services (wave 4) (#153)
- cover 14 more services (central + compliance + misc) (#152)
- cover 14 DB-heavy server services + app useApi/useWebSocket hooks (#151)
- cover data/safety/compliance/http services (#150)
- cover shared utils, hooks, and all Zustand stores (#149)
- run vitest in CI + fix stale server tests (#148)
- cover robot detail-view refactor + VR/keyboard teleop (#147)


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

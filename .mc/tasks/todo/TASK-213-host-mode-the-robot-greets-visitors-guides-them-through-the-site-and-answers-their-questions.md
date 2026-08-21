---
id: TASK-213
aliases:
- TASK-213
title: Host mode — the robot greets a visitor, welcomes them to the site (ZeMA), walks them to the places it wants to show, demonstrates its workstation and answers their questions
slug: host-mode-the-robot-greets-visitors-guides-them-through-the-site-and-answers-their-questions
status: todo
priority: 2
owner: ''
projects: []
customers: []
tags:
- core
- agentmode
- g1
- hri
- compliance
sprint: ''
depends_on:
- '[[TASK-194]]'
- '[[TASK-197]]'
- '[[TASK-199]]'
- '[[TASK-209]]'
- '[[TASK-212]]'
due_date: ''
created: 2026-08-17
updated: 2026-08-17
---

# Host mode — the robot greets a visitor, welcomes them to the site, guides them through it and answers their questions

## Description

The second complete **use case** on top of Agent Mode, and the mirror image of TASK-212's patrol: patrol is the
robot alone at night, **host mode is the robot with a human in front of it**. A visitor walks into ZeMA, the
robot sees them, greets them, says what it is and offers a short tour. If they say yes it walks them to an
ordered list of **stops** on the place graph, says a short prepared piece at each one ("this is my workstation —
here I pick an apple off the table onto the plate, with a VLA model we trained ourselves"), optionally
**demonstrates** the skill, and answers questions at any point — grounded in facts the operator authored, and
saying plainly when it does not know. When the visitor leaves or says goodbye, the robot walks back to its
greeting spot and waits for the next one.

Everything stays local (Whisper + Ollama + Piper already run on the robot's box), every leg passes the same
safety gates as an operator `goto`, and the whole thing is legible in the UI as a **Tour** with routes, runs
and a transcript — the same shape operators already learned from Patrol.

## Details

### What already exists (verified 2026-08-17 on `feat/task-212-patrol`)

Almost all of the machinery is built. This task is mostly **composition + a knowledge layer + one UI**.
Line numbers are approximate.

| Capability | Where | Reuse |
|---|---|---|
| **Full local speech loop** — mic → Silero VAD → faster-whisper STT → A2A agent → Piper TTS → speaker, DE/EN auto-detected per utterance, half-duplex turn-taking, "thinking filler" after 2.5 s, wake phrases, `/health /status /config /say /listen/toggle /session/reset /events` on `:8768` | `robot-agent/voice/` — `voice_service/pipeline.py`, `session.py`, `wake.py`, `http_api.py`, `a2a_client.py`, `adapters/g1_audio_adapter.py` (G1 mic multicast + speaker, `:8766`), `README.md`, `ROBOT_DAY.md` (TASK-181) | **The ears and the mouth.** Nothing new is needed to hear or speak. |
| Speech reaches Agent Mode as a normal command, with a `neodem/voice` metadata hint that carries `{speech:true, language}` | `robot-agent/src/agent/agent-executor.ts:128` (`VOICE_METADATA_KEY`, `readVoiceHint`), `:498-630` (Agent Mode branch → `submitCommand({spoken:true, language})`) | The visitor's sentence already becomes a plan. Host mode intercepts a few of them **before** the planner. |
| Spoken acknowledgement + spoken outcome, templated, bilingual, no LLM call in the latency-critical gap | `robot-agent/src/agent-mode/voice-narrator.ts` (`speakThroughVoiceService` → `POST /say`, `PHRASES`, `PLAN_ACK_TIMEOUT_MS`, `SPOKEN_OUTCOME_MAX_MS`) | The **phrasebook pattern**: every fixed host sentence (greeting, offer, handover, goodbye) is a template here, not a model call. |
| `greet` = speak + right-arm wave; `wave`, `speak`, `wait`, `look {speak:true}`, `scan_room`, `posture`, `remember` blocks with one executor and one timeline | `robot-agent/src/agent-mode/types.ts:12` (`AgentBlockKinds`), `block-executor.ts:336-360`, `:893` (`wave`, `WAVE_GESTURE_MS = 4000`), `:940` (`greet`), `:993` (`speak`) | The **stop primitives**. A stop is `goto` + `speak` (+ optional demo). |
| **The robot already greets a person on its own**: idle watcher takes one cheap VLM frame every 3 s, a person who NEWLY appears (absent ≥10 s) fires exactly one greet, built from a template, never through the planner | `robot-agent/src/agent-mode/idle-watcher.ts` (`DEFAULT_PERSON_ABSENT_MS`, `IdleCheck`), `agent-mode-controller.ts:2308` (`onPersonAppeared` — hardcoded "Hello! I am ready whenever you have a job for me."), `:2364` (`startProactivePlan`), `vision.ts:40/172` (`personVisible`, person entity implies it) | **The trigger.** Today the sentence is a constant; host mode makes it the route's greeting + the AI disclosure + the offer, and arms a reply window. |
| Self-initiative gate: battery, known/fresh place, armed base, not damped, crash acknowledged; locomotion kinds gated harder; `posture` never self-initiated | `robot-agent/src/agent-mode/initiative.ts` (`mayInitiate`, `InitiativeOrigin = 'self'|'operator'|'scheduled'`, `SELF_LOCOMOTION_KINDS`, `SELF_INITIATIVE_MIN_BATTERY = 20`) | Every host leg goes through it, unchanged. A tour the **visitor** asked for is `operator`; a tour the robot **offers** is `self`. |
| `goto {place}` — walks into a named place on its own occupancy map, in stages, re-planning as the map grows, refusing keepouts | `navigator.ts` (`navigateToPlace`), `path-planner.ts`, `place-resolver.ts` (`resolvePlaceByName`, `pointInPolygon`), `place-graph-source.ts`, `geofence.ts` — TASK-208/209 | **The leg primitive**, exactly as patrol uses it. |
| Durable memory with trust tiers: `MEMORY.md`, `places/<id>.md` notes (4 KB cap), and **retrieval-by-injection** — the notes for the place the robot is standing in are appended to the planner context, never planned as a step | `workspace.ts:312` (`Workspace`, `placeNoteFile`, `TrustLevels`, `DURABLE_TRUST_LEVELS`), `prompts.ts:212` (the durable-memory section + the rationale) | **The knowledge layer already has a home and a retrieval mechanism.** Tour facts extend it; they do not replace it. |
| Who the robot is, how it may speak, what body it has — three files, three write policies, config wins on conflict | `identity.ts` (`IDENTITY.md`, `SOUL.md` — no write path at all, `BODY.md` regenerated per boot), `agent-mode-controller.ts:2128` (`answerIdentityQuestion` — deterministic, no model) | "Who are you?", "what can you do?", "who built you?" are **already** answered without a model call. Host mode adds "where am I / what is this place". |
| Planner rules that are exactly right for a visitor: a question about the scene must be answered by `look {speak:true}` (never by guessing), a question about what the robot knows here is answered with ONE `speak`, an impossible request is answered with one honest `speak`, spoken text must be in the language the visitor used | `prompts.ts:36-176` (block menu + rules), `planner.ts` (flat schema, one repair retry, honest `speak` fallback) | The Q&A path is the **existing planner path**. This task adds a facts section and one refusal rule. |
| Stop words bypass the planner entirely and latch an E-Stop | `config.ts` (`AGENT_STOP_WORDS = stopp,stop,halt`), `agent-mode-controller.ts:1337` (`submitCommand`) | **The precedent for intercepting an utterance before planning** — which is how "yes/no" to the tour offer and "stop the tour" work. |
| Standing intents: deterministic keyword/place triggers with cooldown + fire budget, **zero model calls** in the matching path | `intents.ts` (`IntentStore`, `intentTriggerMatches`, `INTENT_MAX = 50`) | The design rule host mode copies for yes/no and goodbye detection: keyword matching, never a model, in any path that runs per tick or per turn. |
| **Patrol, end to end** — route model + cron + windows, run/leg/finding persistence, robot-side runner that expands one top-level block into legs, per-leg outcome, abort, refusal reasons, disk cache of the route, photo store with retention sweep, WS fan-out, alerts, deep links, VDA5050 export, full UI | `robot-agent/src/agent-mode/patrol.ts` (`PatrolRouteSource`, `PatrolRunStore`, `buildPatrolBlocks`, `PatrolRunner.begin/drive`, `checkPatrolPreconditions`), `robot-agent/src/api/rest-routes.ts:1296-1380`, `server/src/{routes/patrol.routes.ts,services/PatrolService.ts,services/PatrolSchedulerService.ts,repositories/PatrolRepository.ts}`, `server/prisma/schema.prisma:2611` (`PatrolRoute`/`PatrolRun`/`PatrolFinding`), `app/src/features/patrol/**` — TASK-212 | **The blueprint to copy, file for file.** Tour = the same three-package shape with a different payload. Read `patrol.ts` before writing `host.ts`. |
| VLA skill execution on the robot: closed loop observe → `/predict` → execute against vla-server, sim and hardware, with adapter switching per skill | `robot-agent/src/vla/skill-executor.ts`, `POST /robots/:id/skills/execute` + `/skills/abort` (`rest-routes.ts:356-505`), `server/src/routes/skills.routes.ts`, `schema.prisma:2130` (`SkillDefinition` with `linkedModelVersionId`, `timeout`) | **The demo step.** The tour does not learn to pick anything — it calls the skill that already exists. |
| The apple demo itself: G1 EDU + Dex3-1, black cloth table, red apple left, white plate right, `ego_camera` matched to the dataset | `robot-agent/hardware/sim_evaluator/mjcf/g1_apple_pnp_scene.xml`, `evaluate_vla.py:201` (`g1_apple_pnp` env), `server/src/services/SimulationService.ts:156/203`, `docs/real-g1-apple-runbook.md`, `robot-agent/hardware/real_g1_bridge/README.md` | The exact thing the robot says it does at its workstation. **Note the constraint** in "Decisions" — that scene is fixed-base. |
| Person handling that is already GDPR-shaped: person detected, never identified; the vision prompt forbids faces; a patrol photo with a person in frame is **dropped, not stored** | `vision.ts:5` (module contract), `prompts.ts:249` (`VISION_PROMPT`), `patrol.ts:621` (`photoDropped: 'person'`), `rest-routes.ts:82` (`personalDataGate`) | Host mode stores **no images at all**. The same rule, one step stricter. |
| Compliance + audit: one record per block, mirrored to the server, retention and legal hold | `server-mirror.ts`, `journal.ts` (`fetchJournalRetention`), `server/src/routes/compliance-log.routes.ts` | A tour is auditable like a patrol. |
| Sim scenes and place graphs to shoot this in | `hardware/sim_evaluator/mjcf/g1_warehouse_scene.xml` + `places/places.warehouse.json` (STAGING, AISLE-1..3, DOCK-1, CHARGING-A, CROSS-AISLE), `g1_dex3_house_scene.xml` + `places.house.json`, `sim_g1_dds/sim_node.py`, `demo_clip.py` | The tour route for the demo video and for the Playwright pass. |

**Gaps — nothing of this exists today:**

1. No tour/stop/knowledge model anywhere (`grep -ri "tour\|museum\|guide" src/` hits nothing).
2. The greeting sentence is a **hardcoded English constant** (`agent-mode-controller.ts:2308`) — not per site, not per language, and it says "ready whenever you have a job for me", which is a sentence for an operator, not a visitor.
3. **The robot cannot ask a question and receive the answer.** Speech is fire-and-forget in both directions; there is no "I asked something, the next utterance within N seconds is the reply" state.
4. No grounded fact source for "what is this place / what is that machine" beyond `places/<id>.md` free text, and no rule that forbids the planner from inventing an answer when the facts do not cover it.
5. No way to run a VLA skill from inside an Agent Mode plan — `skills/execute` is a REST endpoint no block reaches.
6. No AI-disclosure utterance anywhere (EU AI Act Art. 50 applies from **2 August 2026** — i.e. now).
7. Nothing tracks "a visitor is with me" — the idle watcher's person flag is edge-triggered for one greet and then forgotten.

### How this is done elsewhere (research, 2026-08-17)

Sources are linked; the design decisions below cite them.

- **NarraGuide** (LLM narrative mobile robot, museum, 20 participants) — [arXiv 2508.01235](https://arxiv.org/html/2508.01235v3). Knowledge is a **2-D semantic map annotated with exhibit information**; the prompt for each turn carries *the current exhibit's introduction + the area description + introductions of nearby exhibits*. Their reported failure modes are the ones to design against: **hallucinated facts that visitors could not detect** (two participants were given fabricated answers about rocks and believed them), bystander speech triggering the robot, **visitors unable to interrupt the robot mid-explanation**, and disambiguation failures when the robot referred to one of several objects in view. Their mitigation is the right one and is cheap: prompt the model to answer *only from the provided context*, low temperature, and recover visibly when it cannot.
- **CLIO** (tour guide robot with co-speech action for attention guidance) — [arXiv 2512.05389](https://arxiv.org/html/2512.05389). The tour is a **finite state machine** (exhibit-introduction state ↔ navigation state) with the LLM inside the states, not around them. Pointing/gesture while naming a thing measurably improves which object the visitor looks at.
- **Next-Gen Museum Guides: autonomous navigation and LLM interaction** — [arXiv 2507.12273](https://arxiv.org/pdf/2507.12273); **LLM-Aided Museum Guide: personalized tours from user preferences** — [Springer](https://link.springer.com/chapter/10.1007/978-3-031-71710-9_18); an autonomous industrial-museum guide with vision + indoor positioning + generative AI — [MDPI Sci 7(4):175, 2025](https://www.mdpi.com/2413-4155/7/4/175); the 5G-TOURS museum guide — [PMC10824989](https://pmc.ncbi.nlm.nih.gov/articles/PMC10824989/).
- **The classics, still the best HRI reading for this**: Robotinho, the humanoid museum tour guide — [Faber et al., RO-MAN 2009 (PDF)](http://www2.informatik.uni-freiburg.de/~joho/publications/faber09roman.pdf); **Lindsey**, a long-term museum deployment and what visitors actually did with it — [ResearchGate](https://www.researchgate.net/publication/338593039).
- **RoboCup@Home** — the Receptionist task was renamed the **Human-Robot Interaction Challenge** for 2025 ([rulebook releases](https://github.com/RoboCupAtHome/RuleBook/releases), [2025 CfP](https://athome.robocup.org/2025-cfp1-all/)); the 2024 OPL winner NimbRo describes greeting, guest handling and foundation-model perception end to end — [arXiv 2412.14989](https://arxiv.org/pdf/2412.14989). Useful as an acceptance script: greet, learn a name, lead to a place, describe.
- **Voice latency and RAG in the speech path**: streaming ASR + quantized LLM + real-time TTS budgets — [arXiv 2508.04721](https://arxiv.org/html/2508.04721v1); **VoiceAgentRAG** dual-agent architecture (a background "slow thinker" prefetches likely follow-up chunks into a cache so the foreground talker never waits on the vector DB) — [arXiv 2603.02206](https://arxiv.org/html/2603.02206v1). Industry practice for a conversational agent is a **sub-600 ms** total turn budget; our measured stack is stt ≈ 0.3 s + agent ≈ 1.2 s + tts ≈ 0.4 s (`ROBOT_DAY.md` step 6), i.e. ~2 s — which is why prepared sentences must never go through the planner.
- **Proxemics**: personal distance is 0.46–1.22 m and a robot should hold the personal/social boundary — [Rios-Martinez et al., Int. J. Soc. Robotics (survey)](https://link.springer.com/article/10.1007/s12369-014-0251-1); evaluation principles for social navigation — [ACM THRI 10.1145/3700599](https://dl.acm.org/doi/10.1145/3700599). ISO 13482 is the personal-care-robot safety standard usually cited alongside.
- **Regulation, and it is live**: EU AI Act **Article 50** transparency obligations apply from **2 August 2026** — a person interacting with an AI system must be informed unless it is obvious ([Art. 50](https://artificialintelligenceact.eu/article/50/), [practical guide](https://artificialintelligenceact.eu/transparency-rules-article-50/), [Cooley note on the 2 Aug 2026 date](https://www.cooley.com/news/insight/2026/2026-08-03-eu-ai-act-transparency-obligations-take-effect-2-august-2026)). **Emotion recognition is prohibited in workplaces and educational institutions** since Feb 2025 — ZeMA is a workplace, so no emotion/affect inference, ever ([Stibbe on Art. 50(3)](https://www.stibbe.com/publications-and-insights/feeling-watched-transparency-obligations-for-emotion-recognition-and)). Deployers of emotion recognition or biometric categorisation must also post notice — we simply do not do either.

### Decisions (read these before implementing)

1. **A tour is a state machine with templated speech; the LLM is used for exactly two things** — answering an unscripted question, and turning an unscripted visitor sentence into a plan. Greeting, offer, stop introductions, handovers, goodbye, yes/no and stop detection are **templates and keyword matches**, like `voice-narrator.ts` and `intents.ts`. Reason: a 2 s planner round-trip in the gap after a visitor stops talking is the one place a spoken interface cannot afford it, and a template cannot promise a step the robot will not execute.
2. **Talk tracks are authored, not generated.** `TourStop.talkTrack` is the sentence the robot says; `TourStop.facts[]` is what it may answer from. Both are operator-authored in the UI. The planner may rephrase **nothing** at a stop. (NarraGuide's undetectable hallucinations are the evidence; a demo to a funder or a school class is the worst possible place for an invented fact.)
3. **Grounded Q&A, with a refusal that is a first-class outcome.** While a tour is running, the planner prompt gets a `Visitor facts` section (current stop's facts + the site card + `places/<id>.md` notes) and one hard rule: *answer only from these facts and from what you can see; if they do not cover it, say so in one sentence and offer to note the question.* An un-grounded answer is a **defect**, and `TourRun` records `answered: 'grounded' | 'declined' | 'from_camera'` per question so the rate is measurable rather than anecdotal.
4. **The robot may ask, and it may be answered.** New minimal state on the controller: `pendingQuestion = {kind, askedAt, expiresAt}`. `submitCommand` consults it **before** the planner (the same place stop words are handled) and routes a matching yes/no/goodbye keyword to the state machine instead of planning it. 30 s expiry, then the offer lapses silently. No model in this path.
5. **Barge-in is not solved and must not be pretended.** The voice service is half-duplex — the mic is muted at the source from utterance-end until playback-end + 250 ms (`README.md` "Turn-taking"), so a visitor **cannot** interrupt a long sentence, which NarraGuide participants complained about explicitly. Mitigation without echo cancellation: **chunk every talk track into ≤2-sentence `speak` blocks** (the mic reopens between them, ~250 ms gaps), cap a stop at ~40 s of speech, and keep the physical/`STOPP` path as the always-available interrupt. Write the limitation into the task's own docs; do not claim barge-in.
6. **Proxemics is a stop distance, not a new planner.** The robot must not close inside ~1.2 m of the person it is talking to. We have no person-relative controller, so: the greeting is spoken **from where it stands** (it does not approach), and during a tour the robot leads and the visitor follows — the existing `AGENT_RANGE_MIN_M` (0.35 m) forward-clearance stop stays the safety floor, and a `TOUR_MIN_PERSON_M = 1.2` check refuses to start a walking leg while `personVisible` and the range sensor reports < 1.2 m ahead. Say why out loud ("please give me a little room and I'll lead the way") rather than silently refusing.
7. **The demo step calls the skill; it does not reimplement it.** A `demo` block POSTs the existing `/robots/:id/skills/execute` and narrates start/finish. **The sim constraint is real and must be honest**: `g1_apple_pnp_scene.xml` is a **fixed-base** G1 (`g1_dex3/g1_43dof_fixedbase_realism.xml`) — the robot in that scene cannot walk, so a walking tour and the apple demo are **not the same MuJoCo process**. Therefore `TOUR_DEMO_MODE` ∈ `narrate` (default in sim: say what happens at this station and report the *last real* skill run's result and model version) | `execute` (real robot at the workstation, or a scene where both are possible). A `demo` block whose mode is `narrate` must say so in its result string — never let the timeline imply a grasp happened.
8. **Origin.** A tour the visitor asked for is `InitiativeOrigin.operator`; a tour the robot **offered on its own** is `self` and therefore needs battery ≥ 20 %, a known/fresh place, an armed base, no damp, crash acknowledged — the same gate as the heartbeat. Do **not** add a fourth origin; `scheduled` stays patrol's.
9. **The disclosure sentence is not optional and not configurable away.** The first thing said to a new person contains, in their language: what the robot is (an AI-driven robot), that the conversation is processed by an AI, and that it records no video or audio. Default text lives in source (reviewed like code, à la `DEFAULT_SOUL`); the site may *extend* it, never remove it.
10. **No images, no audio, no identity.** Host mode stores **no photos at all** (patrol's `photoDropped: 'person'` becomes "never capture"), no recordings, no face/voice embeddings, no age/gender/emotion inference. What persists per stop: the text of the visitor's question, the answer, timings — trust level `untrusted`, retention swept like patrol photos. A `TOUR_TRANSCRIPT_ENABLED=false` switch drops even that.

### Deliverables

#### Shared contract (three packages, mirrored — same discipline as TASK-212)

`robot-agent/src/agent-mode/types.ts`, `server/src/types/agent-mode.types.ts`, `app/src/features/agentmode/types/agentmode.types.ts`:

```ts
// New block kinds. Only TourRunner emits them — exclude from PlannerBlockKinds
// exactly like PatrolOnlyBlockKinds.
'tour'     // top-level, expanded into legs by the runner
'present'  // say one authored chunk at a stop  {stopId, text, chunk, of}
'demo'     // run a VLA skill, or narrate it    {stopId, skillId, mode:'execute'|'narrate'}

export interface TourStop {
  id: string;
  placeId: string;              // resolved via place-resolver, like a patrol checkpoint
  headline: string;             // ≤ 60 chars, shown in the UI and on the block card
  talkTrack: string;            // ≤ 600 chars, authored; chunked into ≤2-sentence `present` blocks
  facts: string[];              // ≤ 8 × ≤ 200 chars — the ONLY ground for Q&A at this stop
  demo?: { skillId: string; skillName: string; modelVersionId?: string; expectSeconds: number };
  dwellS: number;               // seconds to wait for questions after the talk track (default 12)
  askToContinue: boolean;       // "shall we go on?" — waits for a yes, else lapses after 30 s
}

export interface TourRoute {
  id: string; name: string; robotId: string | null; twinId: string | null;
  language: SpokenLanguage;     // 'de' | 'en' — the tour's default; a visitor's language wins per turn
  greetingPlaceId: string;      // where the robot waits and returns to
  greeting: string;             // authored welcome; the AI disclosure is appended by the robot
  offer: string;                // "shall I show you around? it takes about 6 minutes"
  farewell: string;
  siteCard: string[];           // ≤ 10 facts true anywhere on this tour (what ZeMA is, who runs it)
  stops: TourStop[];
  enabled: boolean;
  autoGreet: boolean;           // may the robot offer this tour to a person it sees, unprompted?
}

export type TourRunStatus = 'running' | 'done' | 'declined' | 'abandoned' | 'aborted' | 'failed' | 'skipped';
export type TourTurnAnswer = 'grounded' | 'from_camera' | 'declined' | 'unanswered';
export interface TourTurn { at: string; stopId: string | null; question: string; answer: string; answered: TourTurnAnswer; }
export interface TourLeg  { stopId: string; name: string; status: AgentBlockStatus; startedAt?: string; finishedAt?: string; message?: string; demo?: { status: string; steps?: number; durationMs?: number; model?: string }; }
export interface TourRun  { runId: string; routeId: string; routeName: string; robotId: string;
  origin: 'visitor' | 'operator'; status: TourRunStatus; reason?: string;
  startedAt: string; finishedAt?: string; legs: TourLeg[]; turns: TourTurn[]; planId?: string; language: SpokenLanguage; }
```

New events on the existing `AgentModeEventTypes` / WS fan-out: `agent:tour:started|leg|turn|finished`, mirrored by
`ServerMirror` exactly like `agent:patrol:*`.

#### Robot agent

- **`robot-agent/src/agent-mode/host.ts`** — modelled on `patrol.ts`, and small because it delegates:
  `TourRouteSource` (fetch from server, disk cache at `AGENT_TOUR_ROUTE_CACHE_PATH`, same failure handling as
  `PatrolRouteSource`), `TourRunStore` (runs + turns in the workspace, retention sweep), `buildTourBlocks(route)`
  (→ `goto` / `present`×n / `demo` / `wait` per stop, then `goto greetingPlace` + farewell),
  `checkTourPreconditions` (battery, place, armed, damped, geofence on every stop, **`TOUR_MIN_PERSON_M`**),
  and `TourRunner.begin/drive/requestAbort` driving the same `PatrolExecution`-shaped interface the controller
  already implements for patrol.
- **`agent-mode-controller.ts`**:
  - `onPersonAppeared` (`:2308`) — when host mode is on, a tour route is bound and `autoGreet` is true, build the
    greet from `route.greeting` + disclosure + `route.offer` in `route.language`, then set
    `pendingQuestion = {kind:'offer', expiresAt: +30 s}`. Otherwise: today's behaviour, unchanged.
  - `submitCommand` (`:1337`) — after the stop-word check and **before** planning, consult `pendingQuestion`:
    yes/no/goodbye keyword lists per language (constants in `host.ts`, no model) route to
    `startTour` / `declineTour` / `endTour`. Anything else falls through to the planner as it does today.
  - Q&A grounding — while a run is active, pass `visitorFacts` (current stop's `facts` + `siteCard` +
    `places/<id>.md` note) into `buildPlannerPrompt`, and classify the produced answer into `TourTurn.answered`.
  - `tourStatus()`, `tourRuns(limit)`, `tourRun(runId)` — mirrors `patrolStatus()` (`:2670`).
- **`prompts.ts`** — a `Visitor facts` section + one rule: *answer visitor questions ONLY from these facts or from
  what a `look` shows; if neither covers it, say in one sentence that you do not know and offer to pass the
  question on. Never invent a number, a name or a date.*
- **`block-executor.ts`** — `present` (speak the chunk via `this.say`, abortable like `wait`), `demo`
  (`POST http://localhost:<agentPort>/api/v1/robots/:id/skills/execute` in `execute` mode; in `narrate` mode say
  the prepared line and report the last known run) — both honest in their `result` strings.
- **`rest-routes.ts`** — `POST /robots/:id/agent-mode/tour {routeId, origin, route?}`, `POST …/tour/abort`,
  `GET …/tour`, `GET …/tour/runs`, `GET …/tour/runs/:runId` — the shape of the patrol block at `:1296-1380`.
- **Config** (`robot-agent/src/config/config.ts`, `.env.example`): `AGENT_HOST_ENABLED`, `AGENT_TOUR_ROUTE_ID`,
  `AGENT_TOUR_ROUTE_CACHE_PATH`, `AGENT_TOUR_REPLY_WINDOW_MS=30000`, `AGENT_TOUR_DWELL_S=12`,
  `TOUR_MIN_PERSON_M=1.2`, `TOUR_DEMO_MODE=narrate`, `TOUR_TRANSCRIPT_ENABLED=true`,
  `TOUR_DISCLOSURE_EXTRA` (appended, never replaces).

#### Server

- `server/prisma/schema.prisma`: `TourRoute`, `TourRun` (with `turns` JSON), `tenantId`-scoped, JSON columns as
  TEXT — copy `PatrolRoute`/`PatrolRun` at `:2611` including the "no FK from run to route" decision (history must
  survive route deletion). Migration + `npm run db:push` note for SQLite.
- `TourRepository`, `TourService`, `server/src/routes/tour.routes.ts` mounted at `/api/tour`:
  `GET|POST /routes`, `GET|PUT|DELETE /routes/:id`, `GET /places` (reuse patrol's), `POST /routes/:id/start`,
  `POST /routes/:id/abort`, `GET /runs`, `GET /runs/:runId`. Ingest `agent:tour:*` in `AgentModeService` and
  broadcast on the existing WS channel. One compliance-log record per tour run (`disclosureSpoken: true`).
- **No scheduler.** A tour is triggered by a person or an operator, never by a clock.

#### Frontend

- `app/src/features/tour/` mirroring `features/patrol/` (api, store, hooks, components, pages, types, tests):
  - `TourPage` — routes as cards (stops, duration estimate, auto-greet on/off), an `ActiveRunBanner` with the
    current stop, and run history.
  - `TourEditorPage` — stops picked from the place graph (reuse patrol's `RouteEditor` place picker and
    `RouteOverlay` map preview), talk track with a live character/estimated-seconds counter, facts as a list,
    demo skill picked from `GET /api/skills`, and a **preview button** that POSTs the talk track to
    `POST /api/robots/:id/voice/say` so the author hears it.
  - `RunDetailPage` — the stop timeline plus the **Q&A transcript**, each turn badged
    `grounded / from camera / declined`, with the declined ones surfaced as "facts to add".
  - Sidebar entry "Guide" next to "Patrol" (`app/src/components/layout/Sidebar.tsx:163`), route `/tour` in
    `App.tsx` next to the patrol block at `:220`.
- Agent Mode cockpit: when a tour is running, `BlockTimeline`'s leading area shows the current stop headline, and
  `present`/`demo` blocks render with their own icons in `BlockCard`/`blockFormat.ts`.

#### Content for the ZeMA demo

- `robot-agent/hardware/sim_evaluator/places/places.warehouse.json` — reuse as-is for the sim tour
  (STAGING → AISLE-1 → DOCK-1 → CHARGING-A → STAGING).
- A seed route JSON checked into `server/src/database/seeds/` ("ZeMA visitor tour") with real, checkable facts and
  the workstation stop whose demo is the apple pick — the sentence in the use case
  ("here is my working station — I pick an apple onto a plate with a VLA model we trained ourselves") is the
  `talkTrack` for that stop, and the model/dataset numbers go into `facts[]`.

### Key files

**Create:** `robot-agent/src/agent-mode/host.ts`, `robot-agent/src/agent-mode/__tests__/host.test.ts`,
`server/src/routes/tour.routes.ts`, `server/src/services/TourService.ts`,
`server/src/repositories/TourRepository.ts`, `server/src/__tests__/TourService.test.ts`,
`server/src/__tests__/tour-routes.test.ts`, `app/src/features/tour/**`,
`server/src/database/seeds/tour-zema.seed.ts`.

**Modify:** `robot-agent/src/agent-mode/{types.ts,agent-mode-controller.ts,block-executor.ts,prompts.ts,idle-watcher.ts}`,
`robot-agent/src/config/config.ts`, `robot-agent/src/api/rest-routes.ts`, `robot-agent/.env.example`,
`server/prisma/schema.prisma`, `server/src/types/agent-mode.types.ts`, `server/src/services/AgentModeService.ts`,
`server/src/websocket/index.ts`, `server/src/index.ts` (mount), `app/src/App.tsx`,
`app/src/components/layout/Sidebar.tsx`, `app/src/features/agentmode/{types/agentmode.types.ts,utils/blockFormat.ts,components/BlockCard.tsx,components/BlockTimeline.tsx}`,
`docs/architecture.md` (one paragraph), `robot-agent/AGENTS.md`.

## Test Strategy

**Unit — robot agent** (`host.test.ts`): `buildTourBlocks` chunks a 600-char talk track into ≤2-sentence
`present` blocks and never exceeds the per-stop speech cap; `checkTourPreconditions` refuses on low battery,
unknown/stale place, damped base, a keepout stop and a person closer than `TOUR_MIN_PERSON_M`, each with its own
reason; the yes/no/goodbye matcher is case/punctuation-insensitive in DE and EN and matches **no** model call;
`pendingQuestion` expires after 30 s and a late "ja" then plans normally instead of starting a tour; a `demo`
block in `narrate` mode says so in its result and never calls `/skills/execute`; an aborted run marks the
remaining legs `skipped` and still speaks the farewell; a run interrupted by a restart is closed by the boot
sweep (patrol's bug, do not re-introduce it).

**Unit — planner grounding** (`planner`/`prompts` tests): with facts that do not cover the question, the produced
plan is exactly one `speak` block whose text contains a refusal, classified `declined` — and the prompt contains
no fact the operator did not author.

**Unit — server**: route CRUD + validation (stops reference known places, talkTrack/facts length caps,
a route with no stops is rejected), run ingest from `agent:tour:*`, tenant scoping, and a run that survives
deleting its route.

**Unit — app**: store reducers for `agent:tour:*` including the out-of-order/late-event guard patrol needed;
`RunDetail` renders declined turns as "facts to add"; the editor's second-counter matches the robot's chunking.

**Live, in sim** (`.env.g1-edu-agent-warehouse`, warehouse scene, voice service on `:8768` with
`VOICE_WAKE_PHRASES` empty): stand a person in front of the robot → it greets **in German**, states it is an AI,
offers the tour; say "ja" → it walks STAGING → AISLE-1 → DOCK-1 → CHARGING-A, says each talk track, pauses for
questions; ask a covered question → grounded answer; ask "wie viel hat der Roboter gekostet?" → an explicit
"das weiß ich nicht" and a `declined` turn in the run; say "stopp" mid-tour → E-Stop latches and the run ends
`aborted`; say "danke, tschüss" → farewell and return to STAGING. Record it with
`hardware/sim_g1_dds/demo_clip.py` (part clips into an `assets/` folder, per the house style).

**Live, hardware** (only when the G1 is on the bench, after `ROBOT_DAY.md` steps 1–6 pass): the same script with
`TOUR_DEMO_MODE=execute` at the workstation stop, and a measured turn latency from `GET :8768/status`
(p50/p95 for stt/agent/tts) recorded in the task's status note.

**Frontend (Playwright MCP)**: create a route with three stops and a demo in the editor, start it from the UI
against the sim, watch the active-run banner follow the stops, open the run and read the transcript, and check
the whole flow in dark mode + at 390 px.

**Acceptance:** one uninterrupted sim run in which a visitor is greeted, accepts, is walked to three stops with
their talk tracks, asks two questions — one answered from the facts and one honestly declined — and is said
goodbye to, with the whole thing visible as one `TourRun` in the UI, one compliance record, and **zero stored
images or audio**.

---
id: TASK-241
aliases:
- TASK-241
title: Actors, comments and ratings — let people and agents leave a judgement with
  evidence on datasets, models, episodes and runs
slug: actors-comments-and-ratings
status: todo
priority: 2
owner: ''
projects: []
customers: []
tags:
- core
- training
- compliance
sprint: ''
depends_on:
- '[[TASK-238]]'
- '[[TASK-240]]'
due_date: ''
created: 2026-09-04
updated: 2026-09-04
status_note: 'Written 2026-09-04. Depends on TASK-238 and TASK-240 because two of the
  four comment subjects (ModelVersion, DatasetView) only become addressable there.'
---

# Actors, comments and ratings

## Description

A shared discussion layer over datasets, dataset views, model versions,
episodes and training runs — where both humans and agents can leave a comment
and a structured rating, and where an agent's rating must cite the evidence that
justifies it.

## Details

### Current state

- **No general comment or rating model.** Of 108 Prisma models, the only
  review-shaped ones are `ADMReviewQueue` (an EU AI Act approval queue) and
  `ListingReview` — marketplace-scoped, one review per author per listing,
  `rating Int` 1-5, no threading, no subject other than a listing. It should not
  be twisted into this; different subject, different lifecycle.
- **No actor identity for agents.** The existing convention is a null user:
  `ComplianceLog.operatorId` is `String? // User/operator ID (null for
  autonomous operations)`. That answers "was it a human?" but not "which
  agent?", which is the question that matters once several agents experiment in
  parallel. `AgentCard` (`server/prisma/schema.prisma:426`) exists as an A2A
  registry with a unique `name` and an optional `robotId` — the natural place to
  resolve an agent actor from.
- **Machine judgements already exist but are not comments.** `EpisodeReward`
  (robometer/topreward scores), `DatasetEpisodeFlag` (operator keep/remove),
  `EvaluationEpisode` (per-rollout success), `SimToRealValidation`
  (`domainGapScore`). These stay as they are — this layer links to them as
  evidence rather than replacing them.

### Server

**Actor** — a value object, not a table. Every row in this feature carries:

```ts
export type ActorType = 'user' | 'agent' | 'system';
export interface Actor {
  actorType: ActorType;
  actorId: string;      // User.id, AgentCard.name, or a service name
  displayName: string;  // denormalized, so a deleted actor still reads
}
```

Denormalizing `displayName` follows the convention already used by
`MarketplaceListing.sellerName` and `ListingReview.authorName` — loose id
strings with no FK to `User`.

**Schema** (`server/prisma/schema.prisma`):

```prisma
model Comment {
  id           String   @id @default(uuid())
  tenantId     String?
  subjectType  String   // dataset | model_version | episode | training_job | experiment
  subjectId    String
  episodeIndex Int?     // only for subjectType 'episode', with subjectId = datasetId
  parentId     String?  // threading, one level deep
  parent       Comment? @relation("Thread", fields: [parentId], references: [id], onDelete: Cascade)
  replies      Comment[] @relation("Thread")
  actorType    String
  actorId      String
  displayName  String
  body         String
  evidenceJson String   @default("[]") // JSON: EvidenceRef[]
  editedAt     DateTime?
  deletedAt    DateTime?   // soft delete; a thread with replies must not vanish
  createdAt    DateTime @default(now())

  @@index([subjectType, subjectId, createdAt])
  @@index([actorType, actorId])
}

model Rating {
  id            String   @id @default(uuid())
  tenantId      String?
  subjectType   String
  subjectId     String
  episodeIndex  Int?
  actorType     String
  actorId       String
  displayName   String
  score         Float    // 0..1, normalized
  dimensionsJson String  @default("{}") // JSON: Record<string, number>, each 0..1
  evidenceJson  String   @default("[]")
  comment       String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@unique([subjectType, subjectId, episodeIndex, actorType, actorId])
  @@index([subjectType, subjectId])
}
```

One rating per actor per subject, updated in place — the unique constraint
mirrors `ListingReview`'s `@@unique([listingId, authorId])`. History is not kept
in v1; say so rather than half-keeping it.

**Score is 0..1, not 1-5 stars.** A reward model emits a continuous score and a
success rate is a fraction; forcing those onto a five-point scale to sit next to
a human's opinion loses information in the direction that matters. The UI
renders 0..1 as five stars for humans and as a percentage for machines.

**Dimensions** — a fixed vocabulary per subject type, in
`server/src/types/social.types.ts`, so ratings are comparable:

- dataset / view: `coverage`, `cleanliness`, `diversity`, `labelQuality`
- model_version: `successRate`, `robustness`, `latency`, `simToRealGap`
- episode: `demonstrationQuality`, `taskCompletion`
- training_job / experiment: `resultStrength`, `reproducibility`

All optional; `score` is the only required number.

**Evidence** — the load-bearing part:

```ts
export type EvidenceRef =
  | { kind: 'evaluation_episode'; ids: string[] }
  | { kind: 'sim_to_real_validation'; id: string }
  | { kind: 'episode_reward'; datasetId: string; rewardType: string }
  | { kind: 'training_job'; id: string }
  | { kind: 'model_version'; id: string }
  | { kind: 'dataset'; id: string }
  | { kind: 'external'; uri: string; note: string };
```

**A rating whose `actorType` is `agent` is rejected with a 400 when
`evidence` is empty.** Humans may rate on judgement alone; a machine that
asserts a model is better without naming the run that showed it is producing
noise that later readers cannot sort. Validate that referenced ids exist.

**Service** (`server/src/services/SocialService.ts`): CRUD, thread assembly,
`summary(subjectType, subjectId)` → `{ count, mean, byDimension, byActorType }`
so a card can show a human mean and an agent mean side by side without
conflating them. Subject existence is validated per type before a row is
written — a comment on a deleted dataset is a dangling row nobody will notice.

**Routes** (`server/src/routes/social.routes.ts`, mounted at `/api/social`):

- `GET /api/social/:subjectType/:subjectId/comments` (+ `?episodeIndex=`)
- `POST /api/social/:subjectType/:subjectId/comments`
- `PATCH /api/social/comments/:id`, `DELETE` (soft)
- `GET|PUT /api/social/:subjectType/:subjectId/rating`
- `GET /api/social/:subjectType/:subjectId/summary`
- `GET /api/social/feed?actorType=&subjectType=&limit=` — reverse-chronological
  activity across subjects; this is what makes it read as a network rather than
  as scattered comment boxes, and it is what a human uses to catch up on what
  the agents did overnight.

**Actor resolution** (`server/src/middleware/`): a request authenticated as a
user yields `{ actorType: 'user' }` from the JWT; a request carrying an agent
credential resolves against `AgentCard.name`. With `AUTH_DISABLED=true` in dev,
fall back to a `system` actor rather than inventing a user.

**Compliance:** agent-authored ratings are an automated evaluative output. Write
a `ComplianceLog` entry (`eventType: 'ai_decision'`) for each one, carrying the
evidence refs. Do **not** build a second approval mechanism — an agent rating is
a recommendation, and the gate stays `ADMReviewQueue` / the approvals feature.

### Frontend

New shared feature `app/src/features/social/`:

- `CommentThread.tsx` — list, reply (one level), edit/delete own, agent avatars
  visibly distinct from human ones
- `RatingWidget.tsx` — stars for humans, dimension bars, read-only percentage
  for agent ratings
- `EvidenceChips.tsx` — each evidence ref renders as a link to the run,
  validation or dataset it names. An agent's claim is one click from its proof.
- `ActivityFeed.tsx` — the `/feed` endpoint
- `useSocial.ts`, `socialStore.ts` (Zustand, per `app/AGENTS.md`)

Mounted on: dataset detail + view detail, `DatasetEpisodesPage` (per episode
row), the model detail page from TASK-238, and the training job detail.

### Key files

- `server/prisma/schema.prisma`
- `server/src/types/social.types.ts` (new)
- `server/src/services/SocialService.ts` (new)
- `server/src/repositories/SocialRepository.ts` (new)
- `server/src/routes/social.routes.ts` (new)
- `server/src/app.ts` (route mounting)
- `app/src/features/social/` (new feature)
- `docs/api.md`

## Acceptance Criteria

- [ ] A user can comment and rate on all five subject types
- [ ] An agent rating without evidence is rejected with a 400 that says why
- [ ] An agent rating with evidence pointing at a non-existent id is rejected
- [ ] Evidence chips link to the referenced run / validation / dataset
- [ ] `summary` reports human and agent means separately
- [ ] One rating per actor per subject; a second PUT updates rather than duplicates
- [ ] Soft-deleting a comment with replies keeps the thread readable
- [ ] The feed returns activity across subject types, newest first
- [ ] Each agent rating produces a `ComplianceLog` entry with its evidence
- [ ] A comment on a non-existent subject is rejected

## Test Strategy

- **Unit (vitest, server):** evidence requirement for agents and its absence for
  users; evidence id validation; unique-constraint upsert; soft delete with
  replies; summary split by actor type; subject validation per type; tenant
  isolation under multi-tenancy (`docs/multi-tenancy.md`).
- **Unit (vitest, app):** `RatingWidget` renders stars for a human and a
  percentage for an agent; `EvidenceChips` builds correct routes.
- **Playwright:** comment on a dataset, reload, still there; open an agent
  rating and follow an evidence chip to the evaluation run.

## Notes

Out of scope for v1, listed so they are not silently assumed: reactions/upvotes,
mentions and notifications, rating history, and any ranking of agents by how
useful their past judgements proved. The last one is the interesting one and
needs this layer to exist first.

The existing automatic signals (`EpisodeReward`, `DatasetEpisodeFlag`) are NOT
migrated into `Rating`. They keep their own tables and are referenced as
evidence — they are measurements, and a rating is a judgement about them.

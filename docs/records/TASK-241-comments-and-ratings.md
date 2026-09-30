# TASK-241 — Comments and ratings by people and agents

**Date:** 2026-09-30
**Task:** `.mc/tasks/todo/TASK-241-actors-comments-and-ratings.md`

Immutable once committed. Later changes of mind get their own record.

## What prompted it

The spec fixed the shape (Actor value object, `Comment` + `Rating`, 0..1 score,
fixed dimensions, `EvidenceRef`, agent ratings need evidence) but left open how
a few pieces meet the code that exists. The user asked for those calls to be
made on the implementer's best recommendation and written down.

## Facts established before deciding

| Fact | Why it mattered |
| ---- | --------------- |
| A dataset view is a `Dataset` row with `kind = 'view'` (TASK-240), not its own model | "View" needs its own subject type to be addressable, but no table |
| There is no `Experiment` model; the spec's schema comment lists `experiment` | A subject type with nothing to validate against would accept any id |
| Postgres and SQLite treat NULLs in a unique index as distinct | `@@unique([subjectType, subjectId, episodeIndex, actorType, actorId])` would not stop a second rating on any non-episode subject |
| Agents authenticate with service-account tokens (`ndsa_…`, TASK-165); a service account is a user row, not an `AgentCard` | The spec's "resolve against `AgentCard.name`" needs the agent to say which card it is |
| The dev bypass injects a mock user with no `authType`; JWTs set `human`, service tokens `service` | The three cases can be told apart without touching `authMiddleware` |
| The UI cannot know which comments are the viewer's without knowing the resolved actor | Edit/delete own needs the actor, and `/auth/me` answers only for humans |
| There is no dataset, model or training-job detail route; they are the episodes page and two modals | The spec's mount points map onto those |

## Decisions

1. **Five subject types: `dataset`, `dataset_view`, `model_version`,
   `episode`, `training_job`.** `experiment` is dropped until an experiment
   model exists — accepting it now would accept any id. `dataset` refuses a
   view id (400 naming `dataset_view`), `dataset_view` refuses a materialized
   dataset (404), so a view's discussion is never split across two keys.
2. **Rating uniqueness is enforced on a non-null `subjectKey`** (`subjectId`,
   or `"<datasetId>#<episodeIndex>"` for an episode), unique with
   `subjectType, actorType, actorId`. `episodeIndex` stays as a readable
   column. A concurrent double-create that loses on the index updates the
   winner instead of failing.
3. **Actor resolution** (`server/src/middleware/socialActor.ts`): a human JWT is
   a `user` (an `X-Agent-Name` header is ignored — a person cannot speak as an
   agent); a service token must send `X-Agent-Name` naming an existing
   `AgentCard` (missing → 400, unknown → 403), never a guess; the
   `AUTH_DISABLED` mock user is the `system` actor `dev`, and may name an agent
   so the agent path can be exercised locally.
4. **Evidence existence is checked for every author**, not only agents. A
   person may rate without evidence, but evidence a person does cite must
   resolve too — a dangling chip is the same noise whoever wrote it.
   `external` refs must be http(s) so a chip can never carry `javascript:`.
5. **Compliance entry after the write, awaited.** Each agent rating writes an
   `ai_decision` log (robot key `platform`, `sessionId`
   `social-rating-<agent>`) whose metadata carries the rating id, score,
   dimensions and evidence. A failed log fails the request (500) with the
   rating already stored; the next PUT is idempotent and logs again. No second
   approval mechanism — an agent rating is a recommendation.
6. **Soft delete returns an empty body**; a deleted top-level comment with no
   replies drops out of the thread list, one with replies stays as a
   placeholder. Deleted comments never appear on the feed.
7. **`GET /api/social/me`** was added so the UI can offer edit/delete on the
   viewer's own comments. **`GET …/rating`** returns `{mine, ratings}`.
8. **Mount points:** dataset/view discussion and a per-*selected*-episode
   discussion on `DatasetEpisodesPage` (one panel for the episode being
   watched rather than a thread per row, which would be N requests on open),
   `ModelDetailsModal`, `JobDetailModal`, and a new `/activity` page (a rail
   stop under Build) for the feed.
9. **Evidence chip routes:** evaluation episodes → `/training?tab=evaluation`,
   sim-to-real → `/training?tab=simulation`, rewards and datasets → the
   episodes page, runs → `/training?job=`, models → `/models?model=` (the models
   page now honours that parameter; the episodes page honours `?episode=`).
   The evaluation and simulation tabs do not yet highlight the named row.
10. **Reload persistence is proven against a real server**
    (`app/e2e/live/social.spec.ts`), because the demo build's MSW store is
    in-memory; the demo spec covers the evidence chip and the feed.

## Out of scope (as the task says)

Reactions, mentions/notifications, rating history, ranking agents by past
usefulness. `EpisodeReward` and `DatasetEpisodeFlag` are not migrated; they are
cited as evidence.

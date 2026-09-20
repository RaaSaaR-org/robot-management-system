# Internal research publications

`/research` in the Skill Training rail lists tenant-scoped ideas, experiments, reports, external
job snapshots and dataset assessments. `/research/:id` opens a publication with
its authenticated author, evidence, dataset version and correction links.
The browser is read-only. Existing dataset validator scores remain unchanged.

The list shows newest publications first, with their recorded state (an immutable
snapshot, not live scheduler polling), author and evidence count. Campaign links
apply a server filter; text search is explicitly scoped to the currently loaded
page. Opening a publication and following its parent preserves the list query,
including pagination and search, for the back link.

Details show nested researcher hypotheses, candidate training settings, and
predicted versus observed training outcomes. The loss chart uses the observed
range and labels its step endpoints; it does not establish policy quality.
Training pilots keep deferred simulation and unknown robot performance visible.
Artifact filenames expand to their full URI and publisher checksum. Full JSON
remains available below the readable record, and report headings stay below the
page's single h1. No artifact is fetched automatically by this page.

Apply `server/prisma/migrations/20260920120000_research_publications/migration.sql`
through the normal production PostgreSQL migration flow and regenerate Prisma.
The checked-in development schema uses SQLite; use a separate development database
with `prisma db push`. The integration test exercises this migration on disposable
SQLite as well. No live database migration is performed by adding this feature.

## API

- `POST /api/research/records`: member/owner/service-member publication; 201 for a
  new record, 200 for an identical replay, 409 for conflicting ID/key reuse.
- `GET /api/research/records/:id`: `{record}`, or 404 outside the caller's tenant.
- `GET /api/research/records`: `{records,pagination:{page,pageSize,total,totalPages}}`.
  Filters: `kind`, `campaignId`, `ideaId`, `datasetId`, `sourceRunId`,
  `idempotencyKey`; pagination uses `page` and `pageSize` (1–200).
  The idempotency filter additionally scopes to the authenticated author.

There are no update or delete endpoints. Corrections append a new ID/key with
`supersedesId`. Parent/correction records must exist in the same tenant and
campaign; corrections preserve kind and dataset/version context.

```json
{
  "id": "idea-20260920-001",
  "kind": "idea",
  "version": 1,
  "idempotencyKey": "idea-20260920-001:v1",
  "campaignId": "apple-pnp",
  "ideaId": "idea-20260920-001",
  "title": "Test table appearance diversity",
  "body": {"hypothesis": "Appearance augmentation improves held-out placement"},
  "evidence": []
}
```

Optional envelope fields: `parentId`, `sourceRunId`, `datasetId` together with
`datasetVersion`, and `supersedesId`. The server rejects caller-supplied `author`
or `tenantId`; it assigns `author:{id,name,kind}`, tenant, timestamp and canonical
content hash. IDs and operation keys are scoped to the tenant, and keys also to
the author. Keep the identical envelope when reconciling an ambiguous timeout.
The same actor's token can rotate without changing this identity.

`kind: experiment` stores the complete frozen experiment in `body` (optionally
under `canonicalExperiment`), with top-level `experimentHash` (SHA-256), `id`,
`campaignId` and `ideaId`. Its identifiers must
match the envelope; publish the linked idea first in the same tenant and campaign.
The hash pins the publisher's frozen input and is not independently recomputed by
the server. Plans need no result evidence before execution. Filter with
`rmsctl --json research list --kind experiment`.

`kind: dataset-assessment` requires a dataset in the current tenant, its immutable
version label, evidence and a structured body:

```json
{
  "task": "apple-pnp",
  "datasetManifestSha256": "<64 hex characters identifying the immutable snapshot manifest>",
  "model": "groot-n1.7",
  "rubricVersion": "1",
  "comment": "Schema checked; training usefulness remains unmeasured.",
  "dimensions": {
    "integrity": {"score": 90, "rationale": "Expected files are present"},
    "usefulness": {"score": null, "rationale": "No controlled training comparison"}
  },
  "confidence": 0.7,
  "limitations": ["One camera"]
}
```

Scores are 0–100 or null (unknown), with a rationale per dimension. Confidence is
0–1. This record never changes the dataset's operational quality score.
`datasetVersion` is an opaque immutable version, not necessarily a content hash.
The required body `datasetManifestSha256` separately pins the manifest. Optional
`datasetSourceRevision` must match the catalog's source revision when recorded.
Mock/dry-run provenance markers are rejected in assessment bodies too.

## Scientific evidence boundary

Scientific report bodies require `reportType: scientific`, `executionMode: real`,
`verdict` (`supported|refuted|inconclusive|invalid`), `experimentHash`,
`checkpoint:{uri,sha256}`, nonempty `comparisons`, `prediction`, `limitations`, and
nonempty `evaluations`. Each evaluation must carry:

```json
{
  "engine": "isaac",
  "executionMode": "real",
  "engineVersion": "pinned-version",
  "checkpointSha256": "<64 hex characters matching checkpoint.sha256>",
  "protocolHash": "<64 hex characters>",
  "evidence": [{"uri": "s3://research/run-1/receipt.json", "sha256": "<64 hex characters>"}]
}
```

`engine` is `isaac` or `mujoco`. Checkpoint and receipt references must also occur
in the envelope's top-level evidence manifest. Nested mock/dry-run markers are
rejected, not just a non-real top-level mode. Optional `body.modelVersionId` links
an existing model in the same tenant and is permitted only on scientific reports.
This endpoint does not register, train or deploy a model.

These are **publisher attestations**, not remote artifact verification. The API
does not fetch arbitrary URIs, run simulators, independently recompute metrics or
verify uploaded hashes against bytes. The researcher/evaluator must verify those
before publication. Its service credential is a trusted internal publishing role.
Dataset version labels similarly refer to the publisher's immutable snapshot;
the current dataset catalog has no universal dataset-version table.
Legacy catalog rows with a null tenant must be assigned to the researcher's tenant
before they can be referenced; this API never grants access via a null-tenant fallback.
Artifact URIs cannot contain credentials, query parameters or fragments; store
stable object locations, not expiring download URLs.

Operational failures can be published as `reportType: status` with a summary and
status `blocked|failed|cancelled|needs_reconciliation`. Such records cannot carry
scientific verdicts, comparisons, evaluations, checkpoints or model evidence.
External jobs are immutable snapshots linked by `sourceRunId`; a later scheduler
state is a new publication, not an update and not a second training submission.

## Atomic model registration

`POST /api/research/models` creates an actual staging `ModelVersion` and its
immutable `ResearchModelPublication` receipt in one transaction. A failed receipt
rolls back the model. Identical retries return the same model ID; changed content
under the same ID/key returns 409. This does not change the old model-registration
endpoint's semantics and does not deploy the policy.

The envelope is `{id,version:1,idempotencyKey,campaignId,ideaId?,sourceRunId,
experimentHash,title,artifact:{uri,sha256},datasetId,datasetVersion,
datasetManifestSha256,datasetSourceRevision?,datasetRecipeHash,datasetSources,
parentModelVersionId?,executionMode:'real',evidence}`. Each dataset source is
`{datasetId,version,manifestSha256,weight,episodeIds}`. Weights are positive sampling
weights. All source datasets and an optional parent model must exist in the
caller's tenant; the primary dataset/version/hash must match a recipe source.
The checkpoint must appear in the evidence manifest. The service preserves the
entire mixture in the publication and model's training metadata.

Responses are `{modelVersion,publication,replayed}` (201 new / 200 replay).
`GET /api/research/models` returns `{publications,pagination}` with the same filters
as research records except `kind`; `idempotencyKey` is scoped to author and tenant.
Reports link the returned ID through `body.modelVersionId`.

This registers a verified artifact supplied by the researcher; it does not
independently verify training or evaluation. The caller must gate model publication
on its validated real checkpoint and evaluation, and attach those receipts.

## CLI

```text
rmsctl --json research list --campaign-id apple-pnp
rmsctl --json research list --idempotency-key idea-20260920-001:v1
rmsctl --json research show idea-20260920-001
rmsctl --json --yes research publish --file publication.json
rmsctl --json --yes research publish-model --file model-publication.json
rmsctl --json research models --idempotency-key model-run-1
```

`--yes` is needed for writes. JSON output preserves the server payload, including
future additive fields. Use `RMS_TOKEN` for a service token; secrets never belong
in research manifests. This feature does not add simulation execution.

## Local training-pilot setup (2026-09-20)

The development UI at `http://localhost:1420/research` proxies API requests to
port 3001. The researcher uses `http://localhost:1420/api`. Both research tables
were added to the existing local SQLite database after a consistent SQLite
backup; existing dataset and model rows were retained. No production migration
or model-registry change was performed.

`Agentic Researcher Apple Pilot` is a dedicated `member` service identity in the
`default` tenant. Its token is stored only in the researcher's private `.env` as
`RMS_TOKEN`. With `AUTH_DISABLED=true`, explicit `ndsa_` service tokens now retain
their authenticated author and role limits; no-token local browser behavior is
unchanged. Invalid service credentials return 401 and owner-only operations
return 403 for this member. Authentication and publication checks passed through
both the API and `rmsctl`; the Research page and experiment filter rendered with
HTTP 200 responses and no browser page errors.

The selected existing catalog row is
`0e240695-1a15-40b6-a610-f7e6c8888289`, NVIDIA's
`nvidia/GR00T-N1.7-AppleToPlate`, pinned to source revision
`d89c126a713c6632432a607c12661546ff4d6ea9`. Only this legacy unscoped dataset was
assigned to the default tenant. Its local source contains 402 Parquet files and
402 videos; catalog metadata records 171625 frames at 30 fps. These inventory
checks do not establish train/test splits, normalization provenance or semantic
episode hashes. Cluster materialization must be verified separately.

The pilot publishes ideas, frozen experiments and external-job evidence with
explicit `training-integration-pilot` scope. It stops before simulator execution;
robot performance stays unknown. It must not publish a scientific efficacy
report or imply that offline training loss establishes task success.

# Exporting a training run to a cluster you do not control

`GET /api/training/jobs/:id/export` returns one JSON document that describes a training run
completely enough to execute it somewhere this server cannot reach — a rented GPU box, an
on-prem cluster, an EU-hosted tenant. It is a few kilobytes. It moves no data.

```bash
curl -sO -J "http://<neodem>/api/training/jobs/<jobId>/export"
# → neodem-run-<jobId>.json
```

In the UI it is the **Export run** action on a job card.

## Why a manifest and not a bundle

A LeRobot dataset is hundreds of files and, for the ones this platform actually trains on,
one to ten gigabytes. `nvidia/GR00T-N1.7-AppleToPlate` alone is 402 parquet files and 402
mp4s — 960 MB. Shipping that inside an export would make the export unusable for the case it
exists to serve, and would put a second, staler copy of the data on the cluster.

So the manifest carries **locators, pinned to a commit**, and the cluster fetches the data
itself from the same place this server got it.

## The one field to read first: `datasets[].uri`

Every dataset resolves to a scheme-tagged URI, and the scheme tells you whether the run is
portable at all:

| `uri` | `portable` | What the cluster does |
| --- | --- | --- |
| `hf://<repo>@<40-hex sha>` | `true` | `huggingface-cli download <repo> --revision <sha>` |
| `s3://<bucket>/<prefix>` | `true` | Fetch with its own S3 credentials — **but see below** |
| `file:///abs/path` | **`false`** | **Nothing. The path is on the NeoDEM server's disk.** |

`s3://` names a bucket in **this deployment's** S3-compatible object store (RustFS), not a
bucket in AWS. The URI carries no endpoint, because an S3 URI has nowhere to put one — so a
cluster that resolves it with default credentials reaches public AWS, where the bucket either
does not exist or belongs to a stranger. Every `s3://` member therefore also produces a
`warnings` entry saying so. Give the cluster the endpoint and credentials out of band, or push
the dataset to a Hub repo so it travels on its own.

`file://` is not a failure of the export — it is the honest report of a dataset that only
exists on one machine, which is what a locally recorded or synthetically generated dataset
is until it is pushed somewhere. Every non-portable member also produces an entry in the
top-level `warnings` array, by name. If you want a locally recorded dataset to survive the
trip, push it to a Hub repo or an object store first and re-import it.

The revision is always a resolved commit SHA, never a branch. A run that cites `main` cites
nothing, because `main` moves.

## `compatibility` — read this before spending GPU hours

The manifest embeds the same compatibility report the UI shows when you pick the datasets.
`verdict` is one of:

- **`identical`** — one dataset, or several with the same shape. Concatenable.
- **`compatible`** — differences that do not touch the tensors.
- **`multi_embodiment`** — the members have different state/action widths. This is a
  *trainable* configuration, not an error, but only with a policy that carries per-embodiment
  projectors (GR00T N1.x) and one embodiment tag per member. Concatenating these datasets
  would feed the model vectors of two different meanings.
- **`incompatible`** — the run is refused at submission; you should not see this in an export.

`axes` breaks the verdict down per dimension — LeRobot version, robot type, frame rate, state
width, action width, camera keys, dataset status — with both values and a sentence on what
the difference means for training.

## What the manifest deliberately does NOT contain

- **No credentials.** No worker token, no presigned URL, no Hugging Face token. A private
  dataset requires the cluster to hold its own. This is asserted by a test.
- **No guessed container image.** `runtime.image` is filled from the `TRAINER_IMAGE`
  environment variable on the NeoDEM server. When that is unset the field carries an obvious
  placeholder and a warning, because an image tag that looks plausible and is wrong costs
  more than a hole that is visibly a hole.
- **No residency claim.** `compliance.residency` is `null` and stays `null`: nothing in this
  platform currently records the geographic origin or storage region of a dataset, so an
  "EU-only" assertion cannot be derived from it. Establish residency from the dataset licenses
  and your own storage configuration. If you need this enforced rather than described, that is
  a schema change, not an export change.

## `job.initFrom` — what the run started from

A run does not have to start from one of the six foundation models. It can start from a model
already in this server's registry, or from one checkpoint of another run — that is what
`initFromModelVersionId` / `initFromCheckpointId` on the job record, and what `job.initFrom`
states in the manifest:

```json
"job": {
  "kind": "supervised",
  "baseModel": "groot_n1_7",
  "fineTuneMethod": "lora",
  "status": "running",
  "initFrom": {
    "artifactUri": "s3://vla-models/g1-apple-pnp/v1757000000/",
    "kind": "model",
    "id": "0f1c…"
  }
}
```

| Field | Meaning |
| --- | --- |
| `artifactUri` | Where the starting weights are, read off the registry row at export time |
| `kind` | `model` — a finished, registered `ModelVersion`; `checkpoint` — one epoch of a run |
| `id` | The `ModelVersion` id, or the `ModelCheckpoint` id when `kind` is `checkpoint` |
| `epoch` | Checkpoints only: the epoch those weights were written at |

`initFrom` is `null` for a run that starts from `baseModel` itself, which is most of them.

**`baseModel` still means what it always meant.** It is the architecture, not the origin of
the weights: a run initialised from a `groot_n1_7` fine-tune is still a `groot_n1_7` run, and
that is the field the trainer reads to decide which trainer to start. A submission whose
`initFromModelVersionId` names a model of a *different* base model is refused with a 400 —
those weights cannot be loaded into this run's architecture, and no decision made at
submission time recovers it.

Reading the manifest without this field is how a record ends up saying "groot_n1_7" for a run
that actually continued a 14k-step fine-tune. That is the same failure `datasets[].revision`
exists to close, one level up: the starting weights are an input to the run exactly as the
data is.

### The same field on the worker contract

`POST /api/training/workers/claim` returns `initFrom` beside `job`, `dataset` and `datasets`,
in the identical shape, resolved to the artifact the job names:

```json
{ "job": { … }, "dataset": { … }, "datasets": [ … ], "initFrom": { "artifactUri": "s3://…", "kind": "checkpoint", "id": "…", "epoch": 14 } }
```

The field is **additive and never required**. A worker that ignores it loads `baseModel` from
its usual place and trains as it always has — which is why the server side of this can ship
before the training worker's (that repo is `../training-worker/`, tracked separately). A
worker that does honour it loads those weights instead of the foundation checkpoint, and
`kind` is what tells it whether it is resuming a run (`checkpoint`, optimiser state and epoch
included where the trainer keeps one) or fine-tuning a finished model (`model`).

`initFrom` is `null` when the job starts from a foundation model **and** when the row it named
has since been deleted; the export adds a `warnings` entry for the second case, because a run
whose starting weights cannot be located is not reproducible as written.

## Weights

`weight` is what the operator typed; `normalizedWeight` is that weight over the sum, so the
values sum to 1. Weights 3 and 1 arrive as `0.75` and `0.25`. Sample each dataset at its
normalized weight — this is the mixture ratio, not a loss scale.

## Running it

The manifest is declarative; it is not a script, and it does not know your scheduler. The
fields map onto a LeRobot-style trainer directly:

| Manifest | Trainer |
| --- | --- |
| `datasets[].uri` + `revision` | the dataset repos to pull, pinned |
| `datasets[].normalizedWeight` | mixture sampling ratio |
| `job.baseModel`, `job.fineTuneMethod` | policy and fine-tune method |
| `job.initFrom.artifactUri` | the weights to start from, instead of the foundation checkpoint |
| `hyperparameters` | learning rate, batch size, epochs, LoRA rank … |
| `gpu` | `count`, `memory` (GB), `type` — for placement |
| `runtime.image` / `entrypoint` / `command` | what to execute |

`runtime.command` names this platform's own training worker, which normally *claims* work
from this server over HTTP. A cluster that cannot reach the server must be driven from the
manifest's own fields instead — which is why they are all there. `compliance.notes` says so
in the document itself, so an operator reading only the JSON is not misled.

## Reproducibility

Together, `datasets[].uri` (repo + commit), `hyperparameters`, `job.baseModel`,
`job.initFrom` and `runtime.image` are what it takes to say truthfully what a model was
trained on. All four are
in the manifest; keep it next to the resulting checkpoint. The gap to be aware of is
`runtime.image` when it is a placeholder — fill it in before you rely on the record.

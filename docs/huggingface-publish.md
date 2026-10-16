# Publishing a dataset to Hugging Face

A dataset NeoDEM recorded can be published to a dataset repository on the
Hugging Face Hub from the app: from the dataset card of a completed session
(**Publish to Hugging Face**), from the dataset detail page and from the
datasets list (both under the row's actions). The server uploads the LeRobot
directory straight off its own disk with its own Hub account; nothing goes
through the browser except the choices a person has to make.

## Set up the server once

The server needs a Hub token with write access. It looks, in order, at:

| Where | Notes |
| ----- | ----- |
| `HF_TOKEN` | environment variable |
| `HF_TOKEN_PATH` | path to a file holding the token |
| `$HF_HOME/token` | when `HF_HOME` is set |
| `~/.cache/huggingface/token` | what `hf auth login` writes — a logged-in box needs nothing else |

Optional:

| Variable | Default | Meaning |
| -------- | ------- | ------- |
| `HF_PUBLISH_NAMESPACE` | the token's user | the namespace the dialog prefills, e.g. `zemarobotik` |
| `HF_ENDPOINT` | `https://huggingface.co` | a Hub mirror (or a local test server) |

The token is never returned by the API, never logged, and scrubbed out of
any error text the server keeps. Check the setup without uploading anything:

```bash
curl -s localhost:3001/api/datasets/publish/status
# {"configured":true,"source":"file","user":"huhn511","orgs":["zemarobotik"],"defaultNamespace":"zemarobotik"}
```

`configured: false` means no token was found; an `error` means the Hub
refused it or could not be reached.

## What gets published

- `meta/`, `data/` and `videos/` from the dataset's directory (`storagePath`).
  Anything else in that folder — NeoDEM's own `neodem-episodes.json`, for
  instance — stays on the server. Symlinks are left out and the job says so.
- A dataset card, `README.md`:
  - the dataset's own `README.md`, if its directory has one, uploaded as is;
  - otherwise a generated card: LeRobot front matter (`license`,
    `task_categories: robotics`, tags `LeRobot`, `neodem`, `teleoperation`,
    the robot type and yours, `configs` pointing at `data/*/*.parquet`), the
    task instructions from `meta/tasks.jsonl`, robot type, real or simulated,
    format version, fps, episodes, frames, cameras, the feature table, a
    loading snippet and NeoDEM/ZeMA attribution;
  - a card on the Hub that NeoDEM did not generate is kept, never overwritten.

The commit is then tagged with the dataset's LeRobot codebase version from
`meta/info.json` (`v3.0`), as `lerobot`'s own `push_to_hub` does:
`LeRobotDataset("<repo>")` refuses a repo without that tag. When tagging
fails the publish still ends `done`, with a warning saying so; tag it by hand
with `hf repos tag create <repo> v3.0 --repo-type dataset`.

The repository is created when it does not exist — **private by default**,
with the chosen license. Publishing again to the same repository makes a new
commit; it never deletes files already on the Hub, and it leaves an existing
repository's visibility as it is.

RustFS is not involved: a dataset whose files are not on this server's disk
(an import kept only in the bucket, or a recording on another host) is refused
with `DATASET_NOT_LOCAL`.

## API

### `POST /api/datasets/:id/publish`

```json
{
  "repoId": "zemarobotik/g1-pick-apple",
  "private": true,
  "license": "apache-2.0",
  "tags": ["pick-and-place"],
  "description": "Apple pick-and-place on the real G1, Quest 3 teleop.",
  "force": false
}
```

Only `repoId` is required; a bare name takes the default namespace. Answers
`202` with the job. Refusals carry a stable `code`:

| Status | `code` | When |
| ------ | ------ | ---- |
| 400 | `INVALID_PUBLISH_REQUEST` | a field is malformed or unknown (`fields` names it) |
| 400 | `INVALID_REPO_ID` | not `<namespace>/<name>` in the Hub's rules |
| 403 | `NAMESPACE_FORBIDDEN` | the server's account is neither the namespace nor a member of it |
| 404 | `DATASET_NOT_FOUND` | |
| 409 | `DATASET_NOT_READY` | status is not `ready` |
| 409 | `DATASET_DEGRADED` | its last validation found errors, or a robot-type change invalidated it — send `force: true` to publish anyway (recorded in the job and the audit entry) |
| 409 | `DATASET_IS_VIEW` | a view has no files of its own; materialize it first |
| 409 | `DATASET_NOT_LOCAL` | the directory is not on this server's disk |
| 409 | `PUBLISH_IN_PROGRESS` | this dataset is already being published |
| 502 | `HUB_UNREACHABLE` | the Hub refused the token or could not be reached |
| 503 | `HF_TOKEN_MISSING` | no token configured |

Role: the same as every other dataset write — member or above.

### `GET /api/datasets/:id/publish`

The running or last job: `status` (`running` · `done` · `failed`), `phase`
(`preparing` · `creating_repo` · `uploading` · `committing` · `done` ·
`failed`), `filesDone/filesTotal`, `bytesDone/bytesTotal`, `url`,
`commitOid`, `versionTag`, `card` (`generated` · `local` · `kept`), `repoCreated`,
`warnings`, and `error` when it failed. Jobs live in memory; after a restart
a published dataset answers `{ "status": "done", "url": … }` from its
`huggingFaceRepoId`. A dataset that was itself imported from the Hub keeps
its source repo in that column, so its publish is remembered only in the
audit log.

### `GET /api/datasets/publish/status`

See [Set up the server once](#set-up-the-server-once).

## Audit

Every publish files two entries in the compliance log under
`system:datasets`: `publish.huggingface.start` (repo, visibility, license,
forced, Hub user, actor) and `publish.huggingface` (outcome, commit, files,
bytes, card, error). A dataset leaving the platform is an EU AI Act / GDPR
data-governance event; this is where the record of it lives.

## Before publishing real-robot data

- Look at the episodes first (dataset detail → episode viewer) and delete the
  bad takes; a published commit is public history even if the repo is later
  made private.
- Camera frames can show people in the lab. Keep the repository private until
  everyone visible has agreed to its publication.

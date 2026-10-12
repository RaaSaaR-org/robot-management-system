---
id: "TASK-361"
aliases: ["TASK-361"]
title: "Episode page plays video and handles object feature names and singular camera keys"
slug: "episode-page-plays-video-and-handles-object-feature-names-and"
status: "review"
priority: 2
owner: "huhn511"
projects: []
customers: []
tags: ["core", "datasets"]
sprint: ""
parent: ""
depends_on: []
spe: 3
effort: "medium"
due_date: ""
created: "2026-10-12"
updated: "2026-10-12"
---

# Episode page plays video and handles object feature names and singular camera keys

## Description

The k3d production-near system test (production chart `../deployments/neoDEM`,
images `e2e-31f1853c`) found three failures in the dataset episode browser:
video of a fully imported dataset never plays, the page crashes for pusht and
xarm, and a dataset whose camera is `observation.image` (singular) shows no
camera at all. Fix all three so every imported LeRobot dataset can be watched.

## Details

### Current state

- `GET /api/datasets/:id/episodes/:index/video/:camera` in
  `server/src/routes/datasets.routes.ts` answers a `Range` request on a RustFS
  dataset with a 302 to a presigned URL. In the cluster that URL names
  `http://neodem-rustfs:9000`: the browser gets `ERR_NAME_NOT_RESOLVED`, and
  on an https page it is mixed content as well. A `<video>` always sends
  `Range`, so no RustFS video ever plays.
- The route builds every path as `observation.images.<camera>`, and the HF
  proxy fallback always reads `resolve/main/`, even for a dataset imported
  from a tag such as `v2.1`.
- `app/src/features/training/pages/DatasetEpisodesPage.tsx` calls
  `action.names.flat(2)`. pusht and xarm store names as an object
  (`{ "motors": ["motor_0", "motor_1"] }`), so the page throws
  `names.flat is not a function`.
- The page finds cameras by the `observation.images.` prefix, so pusht's
  `observation.image` (dtype `video`) is never found.
- `server/src/services/lerobot/RemoteDatasetReader.ts` keys an episode's
  `videoWindows` by the short camera name and only matches
  `videos/observation.images.*` columns.

### Server

- Stream RustFS video through the server, never redirect. Honour `Range`:
  206 with `Content-Range` and `Content-Length`, 416 for an unsatisfiable
  range, and read only the requested window from RustFS
  (`RustFSClient.getStream(bucket, key, range?)`), so a v3.0 chunk video is
  never pulled whole for one episode. The local-disk branch shares the same
  range code.
- The `:camera` segment is the full feature key (`observation.image`,
  `observation.images.top`); a bare name (`top`) still means
  `observation.images.top` for older callers. Anything that is not one safe
  path segment is a 400.
- The HF proxy reads `resolve/<dataset.sourceRevision || 'main'>/`.
- `videoWindows` is keyed by the full feature key and matches any
  `videos/<key>/from_timestamp` column.

### Frontend

- `featureNames(names)` and `cameraKeys(features)` in
  `app/src/features/training/components/datasets/episodeFormat.ts`: names may
  be a flat array, a nested array or an object; cameras are the features with
  dtype `video` or `image`. The viewer labels a camera by its short name.

### Key files

- `server/src/routes/datasets.routes.ts`
- `server/src/storage/rustfs-client.ts`
- `server/src/services/lerobot/RemoteDatasetReader.ts`
- `app/src/features/training/pages/DatasetEpisodesPage.tsx`
- `app/src/features/training/components/datasets/episodeFormat.ts`
- `app/src/features/training/components/datasets/EpisodeViewer.tsx`

## Acceptance Criteria

- [ ] A `Range` request for RustFS video answers 206 with `Content-Range` and only that window, read from RustFS as a range; no request answers with a redirect.
- [ ] A request without `Range` answers 200 with the whole file; an unsatisfiable range answers 416.
- [ ] The video route takes the full camera feature key, finds `observation.image`, and still accepts a bare camera name.
- [ ] The HF video proxy reads the dataset's `sourceRevision` instead of `main`.
- [ ] The episode page renders pusht (object-shaped names, singular camera) without crashing, covered by a unit test with the pusht shape.
- [ ] Camera keys come from features with dtype `video` or `image`, and the video URL carries the full key and the episode window.

## Test Strategy

- `server/src/routes/__tests__/datasets-video-routes.test.ts`: 206/200/416,
  no redirect, singular key, bare name, traversal, HF revision.
- `server/src/services/lerobot/__tests__/RemoteDatasetReader.test.ts`:
  `videoWindows` keyed by full key, singular camera included.
- `app/src/features/training/components/datasets/__tests__/episodeFormat.test.ts`
  and `app/src/features/training/pages/__tests__/DatasetEpisodesPage.pusht.test.tsx`.
- In the k3d cluster: open a pusht and an svla_so101_pickplace episode and
  watch the video play.

# Downloading a dataset's files

A dataset stored in a NeoDEM instance can be taken back out as the LeRobot
directory it is stored as — `meta/`, `data/`, `videos/` … at the same relative
paths, byte for byte — straight from the instance's storage, with no Hugging
Face repository in between. It is the way back for a dataset that was
[uploaded directly](dataset-upload.md) to free local disk, and it works the
same for a dataset that was imported from the Hub.

This page is the contract: two read-only endpoints, a file list and a file.
`rmsctl datasets download <id>` is a client of it.

- [At a glance](#at-a-glance)
- [1. The file list](#1-the-file-list)
- [2. One file](#2-one-file)
- [Downloading a whole dataset](#downloading-a-whole-dataset)
- [Errors](#errors)
- [Limits](#limits)
- [What the server guarantees](#what-the-server-guarantees)

## At a glance

```
GET /api/datasets/:id/files?limit=&after=        one page of the stored files   → 200 { files[], nextCursor }
GET /api/datasets/:id/files/content?path=…       one file, raw bytes            → 200, or 206 for a Range
```

Both are under the API base (`https://<host>/api`) and authenticated like
every other `/api/datasets` read (`Authorization: Bearer <token>`; nothing on
an instance with sign-in disabled). A dataset of another organization answers
`404`. Neither changes anything.

## 1. The file list

```
GET /api/datasets/:id/files?limit=1000&after=<nextCursor of the previous page>
```

| Query | | |
| --- | --- | --- |
| `limit` | optional | Files per page, 1–1000. Default 1000. |
| `after` | optional | The `nextCursor` of the previous page. Leave out for the first page. |

**200 OK**

```jsonc
{
  "datasetId": "6d5a0077-6b1f-4920-84a8-1c691903f8e0",
  "storage": "rustfs",              // or "local" on a server without an object store
  "limit": 1000,
  "files": [
    { "path": "data/chunk-000/file-000.parquet",   // relative to the dataset root, forward slashes
      "size": 20955312,                            // bytes
      "etag": "94938d58781b425d3e27f4601ee2bf25",  // the object store's ETag, when there is one
      "sha256": "55577747fa46…" },                 // whole-file SHA-256, when the server knows one
    { "path": "meta/info.json", "size": 7406, "etag": "28dd1398…", "sha256": "293c94a2…" }
  ],
  "nextCursor": null                // a string while there are more pages; pass it as `after`
}
```

- `files` is **everything stored for the dataset**, in ascending byte order of
  `path`, each file exactly once across the pages. Fetch pages until
  `nextCursor` is `null`.
- `size` is what [the file endpoint](#2-one-file) will serve.
- `sha256` is present for a dataset that arrived by a **direct upload whose
  client declared checksums** (`rmsctl datasets upload` does, unless told not
  to) — the server compared them against what it stored when the upload
  finished. A dataset imported from Hugging Face has none; verify those by
  size.
- `etag` is the object store's and is opaque: it is an MD5 only for an object
  stored in one piece, so do not compute it. It is the same value the file
  endpoint sends as `ETag`, which lets a client notice a file that was replaced
  between listing and fetching. A dataset on local disk has none.

The list is what is in the store, not what `meta/info.json` promises: a
tables-only dataset (`importMode: "metadata"`) lists no `videos/`. A dataset
that was uploaded directly lists every file its client declared, the ones
beside the LeRobot tree (`README.md`, …) included — from a server that stores
them; one from before TASK-500 kept only `meta/`, `data/`, `videos/` and
`images/` ([what may be uploaded](dataset-upload.md#what-may-be-uploaded)).

**Checking a local copy without fetching it.** The list alone answers "is
everything in this directory on the instance?": compare each local file's
relative path and size with the list, and its SHA-256 with `sha256` where the
list has one. `rmsctl datasets verify <dataset-id> <dir>` does that, names
every difference and exits non-zero when there is one — the step to run before
a local dataset is deleted.

## 2. One file

```
GET /api/datasets/:id/files/content?path=videos/observation.images.head/chunk-000/file-000.mp4
Range: bytes=52428800-            (optional)
```

`path` is a `path` from the file list, URL-encoded as a query value.

**200 OK** — the whole file. **206 Partial Content** — the requested window.

```
Content-Type: application/octet-stream
Content-Length: <bytes in this answer>
Accept-Ranges: bytes
ETag: "<etag>"                    (when the store has one)
Content-Range: bytes 52428800-208492162/208492163     (206 only)

<raw bytes>
```

- One range per request: `bytes=N-M`, `bytes=N-` (from N to the end) or
  `bytes=-N` (the last N bytes). An `M` past the end is cut to the end.
- **416 `RANGE_NOT_SATISFIABLE`** for a range that starts at or past the end
  (or is malformed), with `Content-Range: bytes */<size>` and `size` in the
  body. An empty file has no satisfiable range — fetch it without the header.
- `HEAD` answers the same headers with no body and does not open the file.
- The bytes are streamed from the store through the API server; the server
  never redirects to the object store (its address is not reachable from
  outside) and never holds a file in memory.

## Downloading a whole dataset

1. Page through `GET /:id/files` and keep the list.
2. For every file, `GET /:id/files/content?path=…` into a temporary name, a
   few files at a time.
3. When a connection ends early, ask again with `Range: bytes=<bytes you
   have>-` and append. Check `Content-Range` says what you asked for.
4. Compare the length with `size`, and the SHA-256 with `sha256` when the list
   carries one; only then give the file its real name.

`rmsctl datasets download <dataset-id> [--out <dir>]` does exactly this: four
files at once by default, unfinished files as `<name>.rmsctl-part`, `--resume`
to continue in a directory that already holds part of the dataset, and a
non-zero exit when any file could not be reproduced.

## Errors

Every refusal is JSON: `{ "error": "<sentence>", "code": "<STABLE_CODE>", … }`.
Branch on `code` (or the status), never on the sentence.

| Status | `code` | Meaning |
| --- | --- | --- |
| 400 | `INVALID_PATH` | `path` is missing, absolute, or has a backslash, a control character, a drive letter, or an empty, `.` or `..` segment |
| 400 | `INVALID_LIMIT` / `INVALID_CURSOR` | `limit` is not 1–1000 / `after` is not a `nextCursor` (a file path) |
| 404 | `NOT_FOUND` | no such dataset (or not yours) |
| 404 | `FILE_NOT_FOUND` | the dataset has no file at `path`; body has `path` |
| 409 | `DATASET_NOT_READY` | the dataset is still `uploading` or `importing`, so its files are not all in place; body has `status` |
| 409 | `DATASET_IS_VIEW` | the dataset is a view with no files of its own |
| 409 | `NO_STORED_FILES` | nothing is stored for this dataset on this instance |
| 403 | `DATASET_PATH_NOT_ALLOWED` | a local dataset whose directory is not under one this server keeps datasets in |
| 416 | `RANGE_NOT_SATISFIABLE` | see above |
| 429 | `RATE_LIMITED` | the dataset-browsing budget is spent; `Retry-After` header |
| 502 | `STORE_ERROR` | the store failed before the first byte of the file, or did not page the list; retry |
| 503 | `STORAGE_UNAVAILABLE` / `STORAGE_TIMEOUT` | the object store is down or did not answer in time; `Retry-After` header |
| 500 | `FILES_ERROR` | an unexpected server fault; retry |

Worth retrying with a pause: `429`, `502`, `503`, `500`, and any network error.
A file whose stream fails **after** its first byte cannot be given a status any
more — the connection is cut, and the client continues with a `Range` request.

A dataset in status `failed` still serves its files, so what was stored can be
inspected.

## Limits

Both endpoints count against the **dataset-browsing** rate-limit budget
(`RATE_LIMIT_MEDIA_MAX`, 3000 requests a minute per client in production — see
[Rate limiting](deployment.md#rate-limiting)), the budget the episode browser
uses. A download is one request per page of the list and one per file (plus
one per resumed file), so a dataset of many thousand small files — camera
frames stored as images — is paced by that budget: wait for `Retry-After` and
carry on.

No request waits on long server-side work, and a file's bytes start flowing at
once, so the API works behind a proxy that caps a request's time to first byte.

## What the server guarantees

- **The same bytes at the same paths.** Files are served as they are stored —
  the layout a direct upload and a Hugging Face import both write:
  `<storagePath><path>`, in the `training-datasets` bucket (or the legacy
  `datasets` one) or under a directory on the server's disk. A local v3.0
  dataset's converted v2.1 view is never what this serves.
- **Nothing outside the dataset.** `path` is checked as a string and is only
  ever joined to the dataset's own prefix. For a dataset on local disk the
  directory must sit under one this server keeps datasets in
  (`DATASET_UPLOAD_DIR` or the recording root — the rule
  [publishing](huggingface-publish.md) goes by), and symlinks are neither
  listed nor followed.
- **No leaked storage connections.** A client that goes away — before the
  store answered, or mid-file — has its store stream cancelled and given back
  (the `sendStream` rule every streamed route follows).
- **Bounded memory.** A file is piped from the store to the response; the list
  is one store page per request.

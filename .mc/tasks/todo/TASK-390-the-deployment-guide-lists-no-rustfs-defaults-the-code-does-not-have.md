---
id: "TASK-390"
aliases: []
title: "The deployment guide lists no RustFS defaults the code does not have"
slug: "the-deployment-guide-lists-no-rustfs-defaults-the-code-does-not-have"
status: "review"
priority: 4
owner: "huhn511"
projects: []
customers: []
tags: ["core"]
sprint: ""
parent: ""
depends_on: []
spe: 1
effort: "low"
due_date: ""
created: "2026-10-13"
updated: "2026-10-13"
---

# The deployment guide lists no RustFS defaults the code does not have

## Description
The environment table in `docs/deployment.md` gives `RUSTFS_ENDPOINT` a default of
`http://localhost:9000` and `RUSTFS_ACCESS_KEY` / `RUSTFS_SECRET_KEY` a default of
`rustfsadmin`. The server has no default for any of them: `getConfigFromEnv()` in
`server/src/storage/rustfs-client.ts` throws unless all three are set, and
`isRustFSConfigured()` / `features.ts` treat an unset `RUSTFS_ENDPOINT` as "no object
storage, use local disk". An operator reading the table would expect a server with
nothing set to reach RustFS on `localhost:9000`.

## Details
- **Current state:** `docs/deployment.md` rows `RUSTFS_ENDPOINT`, `RUSTFS_ACCESS_KEY`,
  `RUSTFS_SECRET_KEY` in the server environment table list defaults.
- **Change:** default column `—` for all three; the endpoint row says unset means local
  disk, the key rows say they are required once the endpoint is set.
- **Key files:** `docs/deployment.md`.

## Acceptance Criteria
- [ ] The three rows list no default value.
- [ ] Each row matches `server/src/storage/rustfs-client.ts` (`getConfigFromEnv`, `isRustFSConfigured`).

## Test Strategy
Docs only: compare the rows with `getConfigFromEnv()` and `features.ts:77`.

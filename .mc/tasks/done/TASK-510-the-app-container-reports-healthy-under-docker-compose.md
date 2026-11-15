---
id: "TASK-510"
aliases: []
title: "The app container reports healthy under Docker Compose"
slug: "the-app-container-reports-healthy-under-docker-compose"
status: "done"                # backlog | todo | in-progress | review | done | cancelled
priority: 3                   # 1=critical, 2=high, 3=medium, 4=low
owner: "claude"
projects: []
customers: []
tags: ["deploy", "core"]
sprint: ""
parent: ""
depends_on: []
spe: 1
effort: "low"
due_date: ""
created: "2026-11-15"
updated: "2026-11-15"
---

# The app container reports healthy under Docker Compose

## Description

Under Docker Compose the `app` container is permanently `unhealthy`: its health probe asks for
`http://localhost:8080/health`, busybox `wget` resolves `localhost` to `::1` first, and nginx
(`app/nginx.conf.template`, `listen 8080;`) listens on IPv4 only. The app serves traffic, but anything gated on
its health (`depends_on: condition: service_healthy`, monitoring) sees it as down.

## Details

- **Current state:** `app/Dockerfile` `HEALTHCHECK` and the `app` service healthcheck in `docker-compose.yml`
  both probe `localhost`. The Helm chart is not affected (it uses `httpGet` probes).
- **Change:** probe `http://127.0.0.1:8080/health` in both places. Adding `listen [::]:8080;` to nginx was
  considered and rejected: it fails to start on hosts with IPv6 disabled.
- **Key files:** `app/Dockerfile`, `docker-compose.yml`.

## Acceptance Criteria

- [x] A container from the app image with no compose override reports `healthy`.
- [x] The compose `app` service reports `healthy`.

## Test Strategy

Build the app image, run it, and read `docker inspect --format '{{.State.Health.Status}}'` after the first
interval; compare with the image from `main` (stays `unhealthy`, probe log
`Connecting to localhost:8080 ([::1]:8080) ... Connection refused`).

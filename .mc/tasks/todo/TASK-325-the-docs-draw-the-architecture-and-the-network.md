---
id: "TASK-325"
aliases: []
title: "The docs draw the architecture and the network"
slug: "the-docs-draw-the-architecture-and-the-network"
status: "in-progress"
priority: 3
owner: "huhn511"
projects: []
customers: []
tags: [core, docs]
sprint: ""
parent: ""
depends_on: []
spe: 2
effort: "medium"
due_date: ""
created: "2026-09-30"
updated: "2026-09-30"
---

# The docs draw the architecture and the network

## Description

`docs/architecture.md` opens with an ASCII diagram that is out of date. It
describes a Raspberry Pi 5 running SQLite, an agent on `:41245`, and the VLA
server reached through the sidecar. No doc shows the network: which process
listens on which port, who opens each connection, and which zone each part
runs in. Replace the stale diagram and add a network doc. Both diagrams are
checked against the code on `main`.

## Details

### Current state

- `docs/architecture.md` — the ASCII block (lines 3–26) and the
  "Communication Protocols" table describe the SO-101 bootstrap setup, not the
  G1-first platform, the cluster deployment or the GPU box.
- No network diagram exists. The ports are scattered across `server/src/index.ts`,
  `robot-agent/src/index.ts`, `robot-agent/src/config/config.ts`,
  `robot-agent/hardware/*.py`, `app/vite.config.ts`, `app/nginx.conf.template`,
  `docker-compose*.yml` and `helm/neodem/templates/`.

### Docs

- `docs/diagrams/architecture-overview.svg` — the lifecycle view. Numbered
  markers 1–6 (Collect → Comply) trace one skill through app, server,
  robot-agent, sidecars, G1, training-worker and vla-server.
- `docs/diagrams/network-architecture.svg` — the zones (operator, cluster,
  robot edge, GPU box, internet), with every link labeled by protocol and port.
- Both SVGs are standalone. They follow light and dark mode through
  `prefers-color-scheme`, render as static images on GitHub, and become
  interactive when the file is opened directly in a browser: click a stage or
  a box to see only its links.
- `docs/network-architecture.md` — new. The network SVG, a Mermaid sequence
  for how a robot joins and stays connected, the port reference table, auth
  boundaries, the differences between dev, compose and Helm, and the gaps
  found while mapping.
- `docs/architecture.md` — the overview SVG and a Mermaid sequence of the
  lifecycle replace the ASCII block. The protocols table points to the network
  doc.
- `CLAUDE.md` — the docs table lists `docs/network-architecture.md`.

## Acceptance Criteria

- [ ] Every port, path and protocol in the two SVGs and the port table has a
      source in the code on `main`.
- [ ] Both SVGs are readable in light and dark mode on GitHub, and click-to-focus
      works when the file is opened directly in a browser.
- [ ] The Mermaid blocks render on GitHub.
- [ ] `docs/architecture.md` no longer claims a Pi 5, `:41245` as the agent
      port, or sidecar → VLA as the main inference path.

## Test Strategy

Open both SVGs in a browser in light and dark mode and click through the
focus states. Preview the two Markdown files on GitHub, or run them through
`@mermaid-js/mermaid-cli`, to confirm that the Mermaid blocks parse.

## Notes

The mapping ran as a workflow: four parallel readers (components, server
network, robot network, deployment) and one verifier that grepped every port.
A second agent checked the 17 commits between 38df1325 and 39f976a0, including
the control leases (TASK-313).

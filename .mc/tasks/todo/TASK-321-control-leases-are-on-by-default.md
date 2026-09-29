---
id: "TASK-321"
aliases: []
title: "Control leases are on by default"
slug: "control-leases-are-on-by-default"
status: "todo"
priority: 3
owner: "huhn511"
projects: []
customers: []
tags: [core]
sprint: ""
parent: "[[TASK-313]]"
depends_on: ["[[TASK-320]]"]
spe: 2
effort: "low"
due_date: ""
created: "2026-09-30"
updated: "2026-09-30"
---

# Control leases are on by default

## Description

Once TASK-315 … TASK-320 have landed, flip the server flag
`CONTROL_LEASES_ENABLED` to default **on**, so every deployment grants
per-user control leases out of the box. The agent flag
`CONTROL_LEASE_REQUIRED` stays default **off** — enforcement is opt-in per
deployment — and the refusal a legacy client gets when an operator turns it on
is documented. Decided by the user on 2026-09-30 (record:
`docs/records/TASK-313-robot-wide-per-user-control-leases.md`, D9 and Resolved
question 4).

## Details

### Current state

- `CONTROL_LEASES_ENABLED` is introduced by TASK-317 with default `false`. By
  analogy with `MULTI_TENANCY_ENABLED` it is expected in
  `server/src/config/features.ts` (`readBoolFlag(name, defaultValue)`) and in
  the `getFeatureFlags()` snapshot served by `GET /api/config/features`
  (`server/src/routes/config.routes.ts`). **Grep first:**
  `git grep -n CONTROL_LEASES_ENABLED` — use wherever TASK-317 actually put it.
  Off: `GET /robots/:id/control-lease` answers `enabled:false` and the POSTs
  answer 404 `{code:'control_leases_disabled'}`.
- `CONTROL_LEASE_REQUIRED` is read in `robot-agent/src/config/config.ts`
  (`controlLease.required: process.env.CONTROL_LEASE_REQUIRED === 'true'`,
  default `false`) and reported as `enforced` by
  `GET /robots/:id/control-lease` (`robot-agent/src/control-lease/control-lease.ts`).
- Refusal codes for clients without a bound lease when `CONTROL_LEASE_REQUIRED`
  is on (defined by TASK-315 / TASK-316 — confirm the final names there):
  - sockets (`/ws/keyboard-teleop`, bilateral teleop): motion frames dropped,
    `{type:'error', code:'lease_required'}`; a bad bind gets `lease_invalid`;
  - REST motion starts while another user holds the lease: 409
    `{code:'control_lease_held', holder:{displayName, userId}, message}`.
  There is no warn-only or grace mode: a legacy client that never binds cannot
  drive an enforced robot.
- Neither flag appears in `server/.env.example`, `robot-agent/.env.example`,
  `helm/neodem/values.yaml` or `docs/deployment.md` on `main` at 38df1325;
  `docs/api.md` (~line 395) mentions `CONTROL_LEASE_REQUIRED` only. Re-grep —
  TASK-317 may have added entries.

### Server

- `server/src/config/features.ts` (or wherever TASK-317 reads it): default
  `CONTROL_LEASES_ENABLED` to `true`; `CONTROL_LEASES_ENABLED=false` still turns
  it off. Keep the flag in `getFeatureFlags()` so the app sees the new default.
- `server/.env.example`: add a commented `# CONTROL_LEASES_ENABLED=true` line
  explaining the default and how to opt out.

### Robot Agent

- `robot-agent/src/config/config.ts`: **no change** to the
  `CONTROL_LEASE_REQUIRED` default (stays `false`); extend the JSDoc on
  `controlLease.required` with the refusal codes above.
- `robot-agent/.env.example`: add a commented `# CONTROL_LEASE_REQUIRED=false`
  line — turning it on refuses motion from clients that never bind a lease.

### Helm

- `helm/neodem/values.yaml` → `server.env.controlLeasesEnabled: "true"`,
  rendered in `helm/neodem/templates/configmap.yaml` next to `AUTH_DISABLED`
  and passed in `helm/neodem/templates/server-deployment.yaml` the same way.
- `helm/neodem/values.yaml` → `robotAgent.env.controlLeaseRequired: "false"`,
  passed in `helm/neodem/templates/robot-agent-deployment.yaml`.
- Only if the chart does not already carry them (TASK-317 may have added them);
  either way, the rendered defaults must be server on / agent off.

### Docs

- `docs/deployment.md`: a short "Control leases" subsection — server flag on by
  default, agent enforcement opt-in, what legacy clients see when
  `CONTROL_LEASE_REQUIRED=true` (the codes above, no grace mode), and that
  enforcement should be turned on only once every client in the deployment
  binds leases (RMS app ≥ TASK-319/320, vrhq with its own integration).
- `docs/api.md`: control-lease section — state the new server default and list
  the refusal codes under `CONTROL_LEASE_REQUIRED`.

### Key files

- `server/src/config/features.ts`
- `server/.env.example`
- `robot-agent/src/config/config.ts` (JSDoc only)
- `robot-agent/.env.example`
- `helm/neodem/values.yaml`, `helm/neodem/templates/configmap.yaml`,
  `helm/neodem/templates/server-deployment.yaml`,
  `helm/neodem/templates/robot-agent-deployment.yaml`
- `docs/deployment.md`, `docs/api.md`
- `server/src/config/__tests__/features.test.ts` (new) or
  `server/src/__tests__/config-routes.test.ts`
- `robot-agent/src/config/__tests__/config-control-lease.test.ts` (new, modelled
  on `config-rtc.test.ts`)

## Acceptance Criteria

- [ ] With `CONTROL_LEASES_ENABLED` unset, the server reports the capability
      enabled and the lease routes answer (no `control_leases_disabled`).
- [ ] `CONTROL_LEASES_ENABLED=false` restores the disabled behaviour.
- [ ] With `CONTROL_LEASE_REQUIRED` unset, the agent reports `enforced:false`
      and unbound clients still drive.
- [ ] `.env.example` files, Helm defaults, `docs/deployment.md` and
      `docs/api.md` state server on / agent off and name the legacy refusal
      codes; the Helm chart renders those defaults.

## Test Strategy

- Server: a unit test that re-imports the flag module with
  `CONTROL_LEASES_ENABLED` unset, `'true'` and `'false'` (`vi.resetModules` +
  `vi.stubEnv`) and asserts `true`, `true`, `false`; update any existing test
  that assumed the old default.
- Agent: a config test asserting `controlLease.required` is `false` when
  `CONTROL_LEASE_REQUIRED` is unset and `true` when it is `'true'`.
- `helm template helm/neodem` and check the rendered env values.
- `./scripts/test-all.sh --skip-pw`.

## Notes

- 2026-09-30: filed from the user's rollout answer on TASK-313 (staged
  default-on of the server flag; agent enforcement opt-in; no grace mode).

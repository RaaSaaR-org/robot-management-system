---
id: "TASK-310"
title: "Publish agent research in NeoDEM"
slug: "publish-agent-research-in-neodem"
status: "done"
priority: 2
owner: "huhn511"
tags: [research, training, ui]
depends_on: []
spe: 5
created: "2026-09-20"
updated: "2026-09-20"
---

# Publish agent research in NeoDEM

Store attributed, tenant-scoped research publications from the external researcher
and make their predictions, results, lineage and evidence readable in NeoDEM.
The external researcher owns execution; this slice does not implement TASK-242's
experiment orchestrator or TASK-241's general comments and ratings system.

## Acceptance criteria

- [x] Immutable records and atomic model publication enforce tenant, author and replay boundaries.
- [x] Explicit service credentials preserve identity and role restrictions in local development.
- [x] Research list supports filters, scoped search, pagination and navigation back to the same view.
- [x] Details show hypotheses, training settings and predicted versus observed outcomes without implying simulator success.
- [x] Evidence, corrections and original record remain inspectable; Markdown cannot execute HTML or unsafe links.
- [x] Desktop and mobile views pass focused tests and browser verification.
- [x] Open a PR containing only the research feature and its required integration changes.

## Notes

The real Discoverer pilot is published locally and stops at `awaiting_evaluation`.
Training loss is an integration result, not measured robot performance.

Validation: 401 focused backend tests; frontend publication/navigation/design checks;
production app build; production demo route smoke at 1440px and 390px. Real local
pilot list, idea, experiment and result pages were also checked at both widths
with zero page errors or horizontal overflow. No simulation was started.

PostgreSQL 16 migration replay and schema drift check passed in an isolated
container: all migrations applied, no difference detected.

PR: https://github.com/RaaSaaR-org/robot-management-system/pull/324

Final review: no blocking findings in publication authentication, tenant scoping,
idempotency, transactional model registration or research UI. Close commit is
prepared for the authorized squash merge after all final-head CI checks pass.

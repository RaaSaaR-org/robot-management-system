---
id: "TASK-305"
aliases: []
title: "Cut the landing page down to an intro"
slug: "cut-the-landing-page-down-to-an-intro"
status: "done"
priority: 2
owner: "huhn511"
projects: []
customers: []
tags: [design, landing]
sprint: ""
parent: ""
depends_on: []
spe:
effort: ""
due_date: ""
created: "2026-09-12"
updated: "2026-09-12"
---

# Cut the landing page down to an intro

## Description

The landing page carried ~3,260 words across ten blocks and read as a reference,
with four sections restating a loop stage the page had already named. Rebuilt as a
seven-section intro for developers, AI engineers, CTOs and managers — 659
always-visible words — with the detail moved into `docs/platform.md`. Split into
four children (TASK-306 … TASK-309) and landed as a single PR, #321.

## Spec

The spec — the shape rule, the seven sections with their one supporting block each,
the per-section instructions, the new doc's headings, and the four claims the
re-verification pass corrected — is distilled in
[`docs/adr/ADR-305-cut-the-landing-page-down-to-an-intro.md`](../../../docs/adr/ADR-305-cut-the-landing-page-down-to-an-intro.md).

It was removed from this file when the epic closed: a spec that outlives its epic
reads as current when it is not.

The interview that produced it, with the alternative each decision rejected, stays
in [`docs/records/TASK-305-cut-the-landing-page-down-to-an-intro.md`](../../../docs/records/TASK-305-cut-the-landing-page-down-to-an-intro.md).

## Notes

Three guards now hold the shape: a word budget over `<main>`, an anchor-integrity
test that resolves every `/docs/platform#…` fragment through the same
`extractHeadings` the docs viewer uses, and a claims test that counts GR00T and
"all-in-one" in shipped copy. Reviewed on six lenses with an adversarial
refutation pass; ten findings survived and were answered before the merge, one of
them an untrue over-the-air delivery claim in the new doc.

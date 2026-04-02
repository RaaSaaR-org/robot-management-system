---
id: TASK-121
aliases:
- TASK-121
title: 'UX: Info-Banner Text kaum lesbar auf Desktop (Low Contrast)'
slug: ux-info-banner-text-kaum-lesbar-auf-desktop-low-contrast
status: done
priority: 2
owner: ''
projects: []
customers: []
tags:
- ux
- a11y
sprint: ''
depends_on: []
due_date: ''
created: 2026-04-02
updated: 2026-04-02
---




# UX: Info-Banner Text kaum lesbar auf Desktop (Low Contrast)

## Description

On multiple pages, the info banner at the top has very low text contrast. The banner uses a light blue/purple background with light-colored text, making title, body text, and bullet points barely readable on Desktop (1920x1080).

This is an **accessibility issue** (WCAG AA requires 4.5:1 contrast ratio minimum).

### Affected pages
- `/explainability` — "What is AI Explainability?" banner
- `/compliance` — "What is Compliance Logging?" banner
- `/incidents` — "Regulatory Compliance" banner

### Current state
- Banner background: light blue/purple gradient
- Text color: very light (possibly `text-blue-300` or similar low-contrast shade)
- Result: text nearly invisible on desktop at full width

### Key files
These banners likely share a common component or use the same Tailwind pattern. Check:
- `app/src/features/explainability/` components
- `app/src/features/compliance/` components
- `app/src/features/incidents/` components
- Or a shared `InfoBanner` / `FeatureBanner` component

### Fix
Increase text contrast in these info banners:
- Darken the text color (e.g. `text-blue-800` instead of `text-blue-300`)
- Or darken the background and use white text
- Ensure WCAG AA contrast ratio (4.5:1 minimum)

## Acceptance Criteria
- [ ] Banner text on `/explainability` is clearly readable on desktop
- [ ] Banner text on `/compliance` is clearly readable on desktop
- [ ] Banner text on `/incidents` is clearly readable on desktop
- [ ] WCAG AA contrast ratio (4.5:1) is met for all banner text

## Test Strategy
1. Open `/explainability`, `/compliance`, `/incidents` on desktop (1920x1080)
2. Verify banner text is clearly readable
3. Check on mobile (390x844) as well

## Screenshots
- `/tmp/ux-review/11-explainability-desktop.png`
- `/tmp/ux-review/14-compliance-desktop.png`
- `/tmp/ux-review/16-incidents-desktop.png`

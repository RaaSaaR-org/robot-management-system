# Scrum Master Agent

Generate a coordination summary by reviewing all planning documents and identifying cross-cutting concerns.

**You MUST follow each step in order.**

## Step 1: Gather All Planning Documents

Read recent files from `docs/planning/`:

```
docs/planning/
├── sprints/      # Current sprint plan
├── standups/     # This week's standups
├── retros/       # Most recent retrospective
├── backlog/      # Latest backlog review
└── releases/     # Active release plan
```

## Step 2: Sprint Health Assessment

From the current sprint plan and recent standups, assess:

- **Progress:** Are we on track?
- **Blockers:** Any unresolved impediments?
- **Goal Risk:** Is the sprint goal at risk?
- **Team Health:** Any signs of overload or burnout?

## Step 3: Cross-Document Analysis

Look for patterns across documents:

- Recurring blockers (same issues in multiple standups)
- Retrospective action items not addressed
- Backlog items affecting current sprint
- Release plan alignment with sprint progress

## Step 4: Identify Escalations

Flag items requiring attention:

1. **Impediments** - Blockers not resolved within 48 hours
2. **Risks** - High-impact risks materializing
3. **Scope** - Scope creep or scope reduction needed
4. **Dependencies** - External dependencies at risk

## Step 5: Weekly Recommendations

Based on analysis, provide:

- Immediate actions needed
- Process improvements to consider
- Communication needs
- Next week's focus areas

## Step 6: Generate Scrum Master Summary

Create the summary with today's date:

**File:** `docs/planning/scrum-master-summary-YYYY-MM-DD.md`

Use this template:

```markdown
# Scrum Master Summary - YYYY-MM-DD

## Quick Status

| Area | Status | Notes |
|------|--------|-------|
| Sprint Health | [GREEN/YELLOW/RED] | [Brief note] |
| Blockers | X active | [Priority blocker] |
| Release Progress | X% | [On track/At risk] |
| Team Health | [Good/Concerning] | [Observation] |

## Sprint Overview

**Current Sprint:** Week of YYYY-MM-DD
**Sprint Goal:** [Goal from sprint plan]
**Progress:** X% complete (Day Y of 5)

### Key Metrics
| Metric | Target | Actual | Status |
|--------|--------|--------|--------|
| Tasks Completed | X | Y | [On track/Behind] |
| Blockers Resolved | - | Y | - |
| Sprint Goal | 100% | X% | [Projected] |

## Active Blockers

| Blocker | Age | Impact | Owner | Resolution Path |
|---------|-----|--------|-------|-----------------|
| [Description] | X days | High | [Team/Person] | [Action] |

## Escalations Required

### Immediate Attention
1. **[Issue]** - [Why it needs escalation] - Recommended action: [Action]

### Monitoring
1. **[Issue]** - [Current status] - Watch for: [Indicator]

## Document Review

### Sprint Plan Status
- Created: YYYY-MM-DD
- Tasks Selected: X
- Completion: Y/X

### Standup Trends (This Week)
- Standups Completed: X/6 (Mon-Sat)
- Recurring Blockers: [List]
- Progress Trajectory: [Improving/Stable/Declining]

### Retrospective Actions
From last retro (YYYY-MM-DD):
| Action Item | Status | Progress |
|-------------|--------|----------|
| [Action] | [Done/In Progress/Not Started] | [Notes] |

### Backlog Health
- Last Review: YYYY-MM-DD
- Tasks Ready for Next Sprint: X
- Refinement Needed: Y tasks

### Release Alignment
- Target: YYYY-MM-DD
- Current Sprint: X of Y
- On Track: [Yes/At Risk]

## Recommendations

### This Week
1. [Immediate action needed]
2. [Focus area for the team]

### Process Improvements
1. [Improvement to consider]

### Communication Needs
- [Stakeholder update needed]
- [Team alignment topic]

## Next Week Focus

1. **Primary:** [Main focus area]
2. **Secondary:** [Secondary focus]
3. **Watch:** [Item to monitor]

## Notes

[Additional observations, context, or concerns]
```

## Step 7: Save and Summarize

Save the document to `docs/planning/scrum-master-summary-YYYY-MM-DD.md`.

Provide a summary to the user:

- Overall sprint/release health
- Critical escalations
- Top recommendations
- Focus for the week

---

**Output:** Summary saved to `docs/planning/`

**Next:** Address escalations and follow up on recommendations

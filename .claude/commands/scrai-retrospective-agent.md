# Retrospective Agent

Analyze the completed sprint to identify what went well, what went poorly, and improvements for next sprint.

Run this on Sunday to close out the previous week's sprint before planning the new one.

**You MUST follow each step in order.**

## Step 1: Load Sprint Data

Read the sprint plan from `docs/planning/sprints/` for this week.

Note:
- Original sprint goal
- Planned tasks
- Success criteria
- Capacity estimates

## Step 2: Gather Completion Data

Run these commands:

```bash
# Get all completed tasks
task-master list --status=done

# Get tasks still in progress (not completed)
task-master list --status=in-progress

# Get tasks that were pending (not started)
task-master list --status=pending
```

## Step 3: Review Daily Standups

Read all 6 standup reports (Mon-Sat) from `docs/planning/standups/` for this sprint week.

Compile:
- Blockers that occurred and their resolution
- Risks that materialized
- Recommendations that were made
- Progress trajectory throughout the week

## Step 4: Calculate Sprint Metrics

Analyze:

- **Completion Rate:** Planned vs delivered tasks
- **Goal Achievement:** Did we meet the sprint goal?
- **Velocity Accuracy:** Estimated vs actual capacity
- **Blocker Impact:** Time lost to impediments
- **Quality Indicators:** Any rework or bugs found

## Step 5: Identify Patterns

Look for:

**What Went Well:**
- Tasks completed ahead of schedule
- Effective blockers resolution
- Good collaboration patterns
- Accurate estimates

**What Went Poorly:**
- Incomplete tasks and why
- Recurring blockers
- Estimation gaps
- Communication issues

## Step 6: Generate Retrospective Document

Create the retrospective with today's date:

**File:** `docs/planning/retros/retro-YYYY-MM-DD.md`

Use this template:

```markdown
# Sprint Retrospective - YYYY-MM-DD

## Sprint Summary

- **Sprint Goal:** [Original goal from sprint plan]
- **Duration:** YYYY-MM-DD to YYYY-MM-DD
- **Goal Achieved:** [Yes/Partially/No]

## Metrics

| Metric | Planned | Actual | Delta |
|--------|---------|--------|-------|
| Tasks Completed | X | Y | +/-Z |
| Sprint Goal | 100% | X% | -Y% |
| Velocity | X tasks | Y tasks | +/-Z |

## What Went Well

| Success | Evidence | Impact |
|---------|----------|--------|
| [Factor] | [Specific examples] | [Benefit] |
| [Factor] | [Specific examples] | [Benefit] |

## What Went Poorly

| Issue | Root Cause | Impact |
|-------|------------|--------|
| [Problem] | [Why it happened] | [Cost/delay] |
| [Problem] | [Why it happened] | [Cost/delay] |

## Blockers Analysis

| Blocker | Duration | Resolution | Prevention |
|---------|----------|------------|------------|
| [Issue] | X days | [How resolved] | [How to prevent] |

## Improvement Recommendations

### Process Improvements
1. [Specific actionable improvement]
2. [Specific actionable improvement]

### Technical Improvements
1. [Specific actionable improvement]
2. [Specific actionable improvement]

### Planning Improvements
1. [Specific actionable improvement]

## Lessons Learned

1. **[Lesson]** - [How to apply it]
2. **[Lesson]** - [How to apply it]

## Action Items for Next Sprint

| Action | Owner | Priority |
|--------|-------|----------|
| [Improvement to implement] | [Team/Person] | High |
| [Improvement to implement] | [Team/Person] | Medium |

## Notes

[Additional observations or context]
```

## Step 7: Save and Summarize

Save the document to `docs/planning/retros/retro-YYYY-MM-DD.md`.

Provide a summary to the user:

- Sprint goal achievement
- Top 3 things that went well
- Top 3 things to improve
- Key action items for next sprint

---

**Output:** Retrospective saved to `docs/planning/retros/`

**Next:** Use learnings when running `/scrai-sprint-planning` for next sprint

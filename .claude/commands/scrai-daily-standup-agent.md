# Daily Standup Agent

Analyze daily progress against the sprint plan and identify blockers or risks.

Run this Monday through Saturday during a sprint week.

**You MUST follow each step in order.**

## Step 1: Load Sprint Context

Read the current sprint plan from `docs/planning/sprints/` (most recent file).

Note:
- Sprint goal
- Selected tasks
- Success criteria

## Step 2: Gather Current Status

Run these commands:

```bash
# Get in-progress tasks
task-master list --status=in-progress

# Get tasks completed since sprint start
task-master list --status=done

# Get pending tasks for the sprint
task-master list --status=pending
```

## Step 3: Read Previous Standups

Check `docs/planning/standups/` for this sprint's previous standups.

Compare:
- What was planned yesterday vs what was completed
- Blockers that were identified - are they resolved?
- Recommendations that were made - were they followed?

## Step 4: Progress Analysis

Calculate:

- **Completion Rate:** % of sprint tasks completed
- **Days Remaining:** Days left in the sprint
- **Trajectory:** On track / Behind / Ahead
- **Sprint Goal Risk:** Low / Medium / High

## Step 5: Identify Blockers and Risks

Look for:

1. **Dependency Blockers** - Tasks waiting on other tasks
2. **Technical Blockers** - Implementation challenges
3. **External Blockers** - Waiting on external input
4. **Risk Indicators** - Tasks taking longer than expected

## Step 6: Generate Standup Report

Create the standup report with today's date:

**File:** `docs/planning/standups/standup-YYYY-MM-DD.md`

Use this template:

```markdown
# Daily Standup - YYYY-MM-DD

## Sprint Context

- **Sprint Goal:** [From sprint plan]
- **Day:** X of 6 (Mon-Sat)
- **Sprint Health:** [GREEN/YELLOW/RED]

## Progress Summary

| Metric | Value |
|--------|-------|
| Tasks Completed | X of Y |
| Completion Rate | X% |
| Days Remaining | X |
| Trajectory | [On Track/Behind/Ahead] |

## Task Status

### Completed Since Last Standup
- Task X: [Title]
- Task Y: [Title]

### In Progress
| Task | Status | Notes |
|------|--------|-------|
| X    | 50%    | ...   |

### Blocked
| Task | Blocker | Impact |
|------|---------|--------|
| X    | ...     | High   |

### Not Started (Sprint Scope)
- Task X: [Title]

## Blockers Identified

1. **[Blocker Name]**
   - Affects: Task X
   - Impact: [High/Medium/Low]
   - Suggested Resolution: [Action]

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| ...  | High       | Medium | ...        |

## Recommendations

1. [Actionable recommendation for the team]
2. [Actionable recommendation for the team]

## Sprint Goal Status

- [ ] On track to achieve sprint goal
- **Confidence:** X% (based on current trajectory)
```

## Step 7: Save and Summarize

Save the document to `docs/planning/standups/standup-YYYY-MM-DD.md`.

Provide a brief summary to the user:

- Sprint health status
- Key blockers requiring attention
- Critical recommendations

---

**Output:** Standup report saved to `docs/planning/standups/`

**Next:** Address blockers and recommendations before next standup

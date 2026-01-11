# Sprint Planning Agent

Generate a weekly sprint plan by analyzing the backlog, team velocity, and previous sprint outcomes.

Run this on Sunday after the retrospective and backlog grooming to start a new sprint week.

**You MUST follow each step in order.**

## Step 1: Gather Task Data

Run these commands to understand the current state:

```bash
# Get all pending tasks
task-master list --status=pending

# Get recently completed tasks (for velocity)
task-master list --status=done

# Get current in-progress work
task-master list --status=in-progress
```

## Step 2: Review Previous Sprint

Read the most recent documents from:

- `docs/planning/retros/` - Last retrospective for lessons learned
- `docs/planning/sprints/` - Last sprint plan to assess accuracy

If this is the first sprint, skip this step.

## Step 3: Analyze Velocity

Based on completed tasks, estimate:

- Average tasks completed per week
- Team capacity (assume 80% for buffer)
- Any known availability constraints

## Step 4: Select Sprint Tasks

From the pending backlog, identify tasks for this sprint based on:

1. **Priority** - High priority tasks first
2. **Dependencies** - Ensure prerequisites are complete
3. **Capacity** - Stay within team velocity
4. **Sprint Goal** - Tasks that align with a cohesive objective

## Step 5: Define Sprint Goal

Create a clear, measurable sprint goal that:

- Summarizes what the sprint aims to achieve
- Is achievable within one week
- Provides focus for daily standups

## Step 6: Generate Sprint Plan Document

Create the sprint plan with today's date:

**File:** `docs/planning/sprints/sprint-planning-YYYY-MM-DD.md`

Use this template:

```markdown
# Sprint Plan - YYYY-MM-DD

## Sprint Goal

[One sentence describing the sprint objective]

## Sprint Duration

- **Start:** YYYY-MM-DD (Sunday)
- **End:** YYYY-MM-DD (Saturday, 7 days)

## Capacity Assessment

- **Velocity:** X tasks/week (based on historical data)
- **Available Capacity:** X% (accounting for meetings, reviews, etc.)
- **Sprint Capacity:** X tasks

## Selected Tasks

| ID | Title | Priority | Complexity | Dependencies | Notes |
|----|-------|----------|------------|--------------|-------|
| X  | ...   | High     | Medium     | None         | ...   |

## Risks and Considerations

- **Risk 1:** [Description] - Mitigation: [Strategy]
- **Risk 2:** [Description] - Mitigation: [Strategy]

## Success Criteria

- [ ] [Measurable outcome 1]
- [ ] [Measurable outcome 2]
- [ ] Sprint goal achieved

## Notes

[Any additional context or decisions made during planning]
```

## Step 7: Save and Confirm

Save the document to `docs/planning/sprints/sprint-planning-YYYY-MM-DD.md`.

Confirm with the user:

- Summary of selected tasks
- Sprint goal
- Any risks requiring attention

---

**Output:** Sprint plan saved to `docs/planning/sprints/`

**Next:** Run `/scrai-daily-standup` Monday through Saturday to track progress

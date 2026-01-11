# Backlog Grooming Agent

Analyze and assess the product backlog health, identify tasks needing refinement, and prepare recommendations for sprint planning.

Run this on Sunday after the retrospective, before sprint planning.

**You MUST follow each step in order.**

## Step 1: Gather Full Backlog

Run these commands:

```bash
# Get all tasks with subtasks
task-master list --with-subtasks

# Get complexity report if available
task-master complexity-report

# Validate dependencies
task-master validate-dependencies
```

## Step 2: Analyze Backlog Health

Assess:

- **Total Size:** Number of pending tasks
- **Priority Distribution:** High/Medium/Low balance
- **Complexity Distribution:** Simple/Medium/Complex tasks
- **Dependency Chains:** Longest dependency sequences
- **Staleness:** Tasks without recent updates

## Step 3: Identify Refinement Needs

Look for tasks that need attention:

1. **Too Large** - Tasks with high complexity that should be broken down
2. **Unclear** - Tasks with vague descriptions
3. **Missing Details** - Tasks without acceptance criteria
4. **Blocked** - Tasks with unresolved dependencies
5. **Stale** - Tasks not updated in a long time

## Step 4: Assess Sprint Readiness

For each high-priority task, check:

- [ ] Clear description and objective
- [ ] Defined acceptance criteria
- [ ] Dependencies identified and resolvable
- [ ] Reasonable complexity (not too large)
- [ ] Required information available

## Step 5: Priority Review

Analyze if current priorities align with:

- Project goals and milestones
- Technical dependencies
- Risk mitigation needs
- Business value

## Step 6: Generate Backlog Review Document

Create the backlog review with today's date:

**File:** `docs/planning/backlog/backlog-review-YYYY-MM-DD.md`

Use this template:

```markdown
# Backlog Review - YYYY-MM-DD

## Backlog Overview

| Metric | Value |
|--------|-------|
| Total Pending Tasks | X |
| High Priority | X |
| Medium Priority | X |
| Low Priority | X |
| Average Complexity | X/10 |

## Health Assessment

**Overall Health:** [HEALTHY/NEEDS_ATTENTION/CRITICAL]

### Strengths
- [Positive aspect of backlog]
- [Positive aspect of backlog]

### Concerns
- [Issue needing attention]
- [Issue needing attention]

## Tasks Needing Refinement

### Too Large (Need Breakdown)
| Task ID | Title | Complexity | Recommendation |
|---------|-------|------------|----------------|
| X | ... | 9 | Split into 3 subtasks |

### Unclear or Missing Details
| Task ID | Title | Issue | Recommendation |
|---------|-------|-------|----------------|
| X | ... | No acceptance criteria | Add specific criteria |

### Stale Tasks
| Task ID | Title | Last Updated | Recommendation |
|---------|-------|--------------|----------------|
| X | ... | 30+ days | Review relevance |

## Dependency Analysis

### Longest Dependency Chains
1. Task X -> Task Y -> Task Z (3 deep)

### Potential Circular Dependencies
- None found / [List if any]

### Blocked Tasks
| Task ID | Blocked By | Resolution Needed |
|---------|------------|-------------------|
| X | Task Y | Complete Y first |

## Priority Recommendations

### Suggested Priority Changes
| Task ID | Current | Recommended | Reason |
|---------|---------|-------------|--------|
| X | Medium | High | Blocks critical path |

### Tasks Ready for Sprint Planning
| Task ID | Title | Priority | Complexity | Ready |
|---------|-------|----------|------------|-------|
| X | ... | High | Medium | Yes |
| Y | ... | High | Low | Yes |

## Recommendations

### Immediate Actions
1. [Action to take before next sprint]
2. [Action to take before next sprint]

### Process Improvements
1. [Suggestion for better backlog management]

## Notes

[Additional observations about backlog health]
```

## Step 7: Save and Summarize

Save the document to `docs/planning/backlog/backlog-review-YYYY-MM-DD.md`.

Provide a summary to the user:

- Backlog health status
- Number of tasks needing refinement
- Top priority recommendations
- Tasks ready for sprint planning

---

**Output:** Backlog review saved to `docs/planning/backlog/`

**Next:** Use recommendations when running `/scrai-sprint-planning`

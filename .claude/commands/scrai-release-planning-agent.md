# Release Planning Agent

Create a multi-sprint release plan by analyzing project scope, dependencies, and team capacity.

**You MUST follow each step in order.**

## Step 1: Define Release Scope

Ask the user or determine from context:

- **Release Name/Version:** What is this release called?
- **Target Date:** When should this release be complete?
- **Key Deliverables:** What must be included?

## Step 2: Gather Project Data

Run these commands:

```bash
# Get all tasks
task-master list --with-subtasks

# Get complexity analysis
task-master complexity-report

# Validate dependencies
task-master validate-dependencies
```

## Step 3: Review Historical Data

Read from `docs/planning/`:

- Recent sprint plans and retrospectives for velocity data
- Backlog reviews for task readiness
- Previous release plans for reference

## Step 4: Scope Analysis

Categorize tasks for this release:

1. **Must Have** - Critical for release success
2. **Should Have** - Important but not blocking
3. **Could Have** - Nice to have if capacity allows
4. **Won't Have** - Explicitly deferred

## Step 5: Capacity Planning

Calculate:

- **Total Effort Required:** Sum of task complexity
- **Team Velocity:** Tasks per sprint (from historical data)
- **Sprints Needed:** Effort / Velocity
- **Buffer:** Add 20% for unknowns

## Step 6: Sprint Sequencing

Plan task distribution across sprints:

1. **Sprint 1:** Foundation and high-risk tasks
2. **Sprint 2-N:** Core features
3. **Final Sprint:** Integration, testing, polish

Consider:
- Dependencies (prerequisites first)
- Risk (high-risk early for buffer)
- Integration points (leave time for integration)

## Step 7: Risk Assessment

Identify release risks:

- Technical complexity
- External dependencies
- Capacity constraints
- Scope creep potential

## Step 8: Generate Release Plan Document

Create the release plan with today's date:

**File:** `docs/planning/releases/release-plan-YYYY-MM-DD.md`

Use this template:

```markdown
# Release Plan - [Release Name] vX.Y

**Created:** YYYY-MM-DD

## Executive Summary

- **Target Release Date:** YYYY-MM-DD
- **Total Sprints:** X
- **Scope:** X tasks
- **Confidence:** X% (on-time delivery probability)

## Release Objectives

1. [Primary objective]
2. [Secondary objective]
3. [Secondary objective]

## Scope Definition

### Must Have (Core)
| Task ID | Title | Priority | Complexity | Sprint |
|---------|-------|----------|------------|--------|
| X | ... | Critical | High | 1 |

### Should Have (Important)
| Task ID | Title | Priority | Complexity | Sprint |
|---------|-------|----------|------------|--------|
| X | ... | High | Medium | 2 |

### Could Have (If Capacity)
| Task ID | Title | Priority | Complexity | Sprint |
|---------|-------|----------|------------|--------|
| X | ... | Medium | Low | 3 |

### Won't Have (Deferred)
| Task ID | Title | Reason |
|---------|-------|--------|
| X | ... | Post-release |

## Sprint Sequence

### Sprint 1: [Theme] (Week of YYYY-MM-DD)
**Focus:** [Sprint objective]

| Task ID | Title | Dependencies | Risk |
|---------|-------|--------------|------|
| X | ... | None | High |

### Sprint 2: [Theme] (Week of YYYY-MM-DD)
**Focus:** [Sprint objective]

| Task ID | Title | Dependencies | Risk |
|---------|-------|--------------|------|
| X | ... | Task Y | Medium |

### Sprint N: [Theme] (Week of YYYY-MM-DD)
**Focus:** Integration and testing

## Critical Path

```
Task X (Week 1) -> Task Y (Week 2) -> Task Z (Week 3)
                                   -> Release
```

**Buffer:** X days available

## Milestones

| Milestone | Target Date | Success Criteria | Status |
|-----------|-------------|------------------|--------|
| [Name] | YYYY-MM-DD | [Criteria] | Pending |
| Release Ready | YYYY-MM-DD | All tests pass | Pending |

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| [Description] | High | Critical | [Strategy] |
| [Description] | Medium | High | [Strategy] |

## Quality Gates

- [ ] All unit tests passing
- [ ] Integration tests complete
- [ ] Code review complete
- [ ] Documentation updated
- [ ] Performance benchmarks met

## Dependencies

### Internal Dependencies
- [Dependency and status]

### External Dependencies
- [Dependency and status]

## Capacity Allocation

| Sprint | Capacity | Allocated | Buffer |
|--------|----------|-----------|--------|
| 1 | 100% | 80% | 20% |
| 2 | 100% | 85% | 15% |

## Success Criteria

1. [Measurable outcome]
2. [Measurable outcome]
3. [Measurable outcome]

## Notes

[Additional context, assumptions, or constraints]
```

## Step 9: Save and Summarize

Save the document to `docs/planning/releases/release-plan-YYYY-MM-DD.md`.

Provide a summary to the user:

- Release timeline and sprint count
- Key milestones
- Critical risks
- Confidence level

---

**Output:** Release plan saved to `docs/planning/releases/`

**Next:** Use this plan to guide weekly `/scrai-sprint-planning` sessions

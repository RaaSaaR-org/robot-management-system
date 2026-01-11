# SCRAI - Scrum AI Planning Framework

A Claude Code framework for autonomous sprint planning, daily standups, and retrospectives. Each agent analyzes project data and produces structured planning documents.

## Weekly Workflow

Sprints run Sunday to Saturday (7 days).

```
Sunday:    /scrai-retrospective       -> Close previous sprint
           /scrai-backlog-grooming    -> Refine backlog
           /scrai-sprint-planning     -> Plan new sprint

Mon-Sat:   /scrai-daily-standup       -> Daily progress report

As needed: /scrai-release-planning    -> Multi-sprint planning
           /scrai-scrum-master        -> Coordination summary
```

### Sunday Routine

1. **Retrospective** - Review the completed sprint (skip if first sprint)
2. **Backlog Grooming** - Refine and prioritize upcoming work
3. **Sprint Planning** - Select tasks and set goals for the new week

## Available Commands

| Command | Purpose | Output |
|---------|---------|--------|
| `/scrai-sprint-planning` | Plan the upcoming sprint | `docs/planning/sprints/` |
| `/scrai-daily-standup` | Daily progress analysis | `docs/planning/standups/` |
| `/scrai-retrospective` | Sprint review and learnings | `docs/planning/retros/` |
| `/scrai-backlog-grooming` | Backlog refinement | `docs/planning/backlog/` |
| `/scrai-release-planning` | Multi-sprint release plan | `docs/planning/releases/` |
| `/scrai-scrum-master` | Coordination overview | `docs/planning/` |

## Document Structure

All planning documents are saved to `docs/planning/`:

```
docs/planning/
├── sprints/                      # Weekly sprint plans
│   └── sprint-planning-YYYY-MM-DD.md
├── standups/                     # Daily standup reports
│   └── standup-YYYY-MM-DD.md
├── retros/                       # Weekly retrospectives
│   └── retro-YYYY-MM-DD.md
├── backlog/                      # Backlog grooming sessions
│   └── backlog-review-YYYY-MM-DD.md
└── releases/                     # Release planning documents
    └── release-plan-YYYY-MM-DD.md
```

## Design Principles

1. **Read-Only Task Analysis** - Agents read task-master data but never modify tasks
2. **Document Everything** - Each agent produces a dated markdown document
3. **Human Decision Making** - Agents recommend, humans decide and execute
4. **Weekly Cadence** - Designed for 1-week sprints with daily standups

## Usage

Run any command to generate the corresponding planning document:

```bash
# Start a new sprint
/scrai-sprint-planning

# Daily standup
/scrai-daily-standup

# End of sprint retrospective
/scrai-retrospective
```

Documents reference each other to maintain context across the sprint cycle.

---
id: TASK-007
aliases:
- TASK-007
title: Build Natural Language Command Interface
slug: build-natural-language-command-interface
status: done
priority: 2
owner: ''
projects: []
customers: []
tags:
- core
sprint: ''
depends_on:
- "[[TASK-001]]"
- "[[TASK-003]]"
- "[[TASK-005]]"
due_date: ''
created: 2026-02-19
updated: 2026-02-19
---



# Build Natural Language Command Interface

## Description
Develop the user interface for inputting and interpreting natural language commands for robots.

## Details
Implement the following modules/features as part of Phase 5:
- **command/api**: Implement API calls for `sendCommand()` including VLA interpretation, dependent on `api/client` and `robots/types`.
- **command/hooks**: Develop `useCommand()` hook, dependent on `command/api` and `robots/hooks`.
- **UI Components**: Create a `CommandBar` for natural language text input, `CommandPreview` to display the VLA model's interpretation (action type, objects, confidence), `CommandConfirmation` modal for user confirmation before execution, and `CommandHistory` to log and search past commands. These components should use `shared/ui` primitives.

## Test Strategy
Unit test `command/api` (mocked API) and `command/hooks`. Use React Testing Library for `CommandBar`, `CommandPreview`, `CommandConfirmation`, and `CommandHistory`. Critical test scenarios include entering a command, displaying its interpretation, confirming execution, and logging history. Test edge cases like low confidence interpretations, ambiguous commands, VLA timeout, and blocked/prohibited actions with appropriate user feedback.
%% mc-links: [[TASK-001]] [[TASK-003]] [[TASK-005]] %%

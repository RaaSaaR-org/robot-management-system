# Implement Task

Implement TaskMaster task **$ARGUMENTS**.

**You MUST follow each step in order.**

## Step 1: Get Task

Run `task-master show $ARGUMENTS` to get task details.

## Step 2: Verify Dependencies

Check all tasks in the `dependencies` array have status `done`.
If not, list the incomplete dependencies and ask user how to proceed.

## Step 3: Load Context

Read these files:

- `docs/architecture.md` - Code structure and patterns
- `docs/dev-workflow.md` - **MANDATORY conventions you must follow**

## Step 4: Research

Explore existing code relevant to the task:

- What already exists that you can reuse?
- What needs to be refactored?
- What needs to be built from scratch?

## Step 5: Plan & Confirm

Present your implementation plan to the user and get confirmation before writing code.

## Step 6: Implement

Follow the implementation order from `.claude/dev-workflow.md`:
types → store → api → hooks → components → pages → tests

## Step 7: Test

Run tests to verify implementation works.

## Step 8: Complete

Run `task-master set-status --id=$ARGUMENTS --status=done`

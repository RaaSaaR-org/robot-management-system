# Review Task

Review and verify TaskMaster task **$ARGUMENTS** is complete and working.

**You MUST follow each step in order.**

## Step 1: Get Task

Run `task-master show $ARGUMENTS` to get task details and understand what was implemented.

## Step 2: Build Check

Run `npm run build` and verify:

- No TypeScript errors
- No build warnings
- Build completes successfully

## Step 3: Test Check

Run tests related to the task:

- Run `npm run test` for unit tests
- Use Playwright MCP to test UI interactions if applicable

## Step 4: Code Review

Review the implementation for:

- Follows conventions in `docs/dev-workflow.md`
- Clean, readable code
- Proper file structure (feature-first)
- File headers present
- Named exports (no default exports)
- No unused imports or dead code

## Step 5: Manual Verification

Use Playwright MCP to manually verify the feature works:

- Navigate to relevant pages
- Test user interactions
- Verify expected behavior

## Step 6: Report

Provide a summary:

- **Build**: PASS/FAIL
- **Tests**: PASS/FAIL
- **Code Quality**: PASS/FAIL (list any issues)
- **Manual Test**: PASS/FAIL

If all pass, recommend marking task as `done`.
If issues found, list them for the user to address.

---
id: TASK-001
aliases:
- TASK-001
title: Setup Core Infrastructure (Foundation Phase)
slug: setup-core-infrastructure-foundation-phase
status: done
priority: 2
owner: ''
projects: []
customers: []
tags:
- core
sprint: ''
depends_on: []
due_date: ''
created: 2026-02-19
updated: 2026-02-19
---



# Setup Core Infrastructure (Foundation Phase)

## Description
Establish the foundational shared infrastructure including UI components, common hooks, API client, and state management store.

## Details
Implement the following modules as defined in Phase 0:
- **shared/components/ui**: Implement primitive UI elements like `Button`, `Card`, `Input`, `Modal`, `Badge` with Tailwind CSS for styling.
- **shared/hooks**: Create base hooks such as `useApi`, `useDebounce`, `useWebSocket`, `useLocalStorage`.
- **api/client**: Set up an Axios instance with interceptors for handling authentication tokens, errors, and retries.
- **store/createStore**: Implement a Zustand factory with middleware for devtools and persistence, ensuring it produces typed stores.

## Test Strategy
Utilize Vitest for unit tests on all implemented components and hooks. Mock API calls using MSW for `api/client` tests to ensure correct token handling and error responses. Verify that the Zustand store factory produces typed stores and integrates with devtools/persistence as expected.

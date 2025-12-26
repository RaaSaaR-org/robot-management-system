/**
 * @file index.ts
 * @description Barrel export for tasks/processes API
 * @feature tasks
 */

export * from './tasksApi';

// Process API alias (user-facing terminology)
export { tasksApi as processesApi } from './tasksApi';

/**
 * @file index.ts
 * @description Barrel export for processes pages
 * @feature processes
 *
 * Note: Primary exports use "Process" naming, with "Task" aliases for backwards compatibility.
 */

// Primary exports - Process naming
export * from './ProcessesPage';
export * from './ProcessDetailPage';

// Legacy aliases are re-exported from the new files
// TasksPage and TaskDetailPage are exported from ProcessesPage.tsx and ProcessDetailPage.tsx

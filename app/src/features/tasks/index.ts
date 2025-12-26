/**
 * @file index.ts
 * @description Barrel export for tasks/processes feature
 * @feature tasks
 *
 * This feature provides both "Task" and "Process" terminology.
 * - "Task" is the internal implementation name
 * - "Process" is the user-facing terminology (workflow with steps)
 *
 * All Task* exports have corresponding Process* aliases.
 */

// Types (includes Process aliases)
export * from './types';

// Store (includes Process aliases)
export * from './store';

// API (includes Process aliases)
export * from './api';

// Hooks (includes Process aliases)
export * from './hooks';

// Components (includes Process aliases)
export * from './components';

// Pages
export * from './pages';

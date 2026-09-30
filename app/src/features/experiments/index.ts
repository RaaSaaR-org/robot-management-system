/**
 * @file index.ts
 * @description Experiments feature exports — the experiment loop: an agent
 *   proposes, a person approves, the platform trains, evaluates and rates
 *   (TASK-242).
 * @feature experiments
 */

export { ExperimentsPage } from './pages/ExperimentsPage';
export { ExperimentDetailPage } from './pages/ExperimentDetailPage';
export { ArmComparisonChart } from './components/ArmComparisonChart';
export { ArmTable } from './components/ArmTable';
export { ApproveExperimentDialog } from './components/ApproveExperimentDialog';
export { ModelExperimentsLink } from './components/ModelExperimentsLink';
export { useExperiments, useExperiment } from './hooks/useExperiments';
export { experimentsApi } from './api/experimentsApi';
export type * from './types/experiment.types';

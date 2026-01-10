/**
 * @file index.ts
 * @description Barrel export for compliance feature
 * @feature compliance
 */

// Types
export * from './types';

// API
export { complianceApi } from './api';

// Store
export { useComplianceStore } from './store';

// Components
export {
  ComplianceLogList,
  ComplianceLogViewer,
  IntegrityStatus,
  RetentionSettings,
  LegalHoldManager,
  ExportDialog,
  RopaTab,
} from './components';
export type {
  ComplianceLogListProps,
  ComplianceLogViewerProps,
  IntegrityStatusProps,
  RetentionSettingsProps,
  LegalHoldManagerProps,
  ExportDialogProps,
  RopaTabProps,
} from './components';

// Pages
export { CompliancePage } from './pages';

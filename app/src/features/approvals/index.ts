/**
 * @file index.ts
 * @description Approvals feature barrel export
 * @feature approvals
 *
 * Human Approval Workflows for regulatory compliance:
 * - GDPR Art. 22: Human review of automated decisions
 * - AI Act Art. 14: Human oversight with meaningful engagement
 * - EDPB WP251: Worker rights in automated processing
 */

// Types
export * from './types';

// API
export { approvalsApi } from './api';

// Store
export { useApprovalsStore } from './store';

// Hooks
export { useApprovals, usePendingApprovals, useApprovalMetrics } from './hooks';

// Components
export { SLAIndicator, ApprovalCard, ApprovalQueue } from './components';

// Pages
export { ApprovalsPage } from './pages';

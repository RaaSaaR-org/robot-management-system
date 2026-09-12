/**
 * @file index.ts
 * @description Barrel export for GDPR components
 * @feature gdpr
 */

export { SLABadge, slaState } from './SLABadge';
export type { SLABadgeProps } from './SLABadge';

export { StatusBadge } from './StatusBadge';
export type { StatusBadgeProps } from './StatusBadge';

export { RequestTypeCard, RequestTypePicker, RIGHTS } from './RequestTypeCard';
export type { RequestTypeCardProps, RequestTypePickerProps } from './RequestTypeCard';

export { RequestTable } from './RequestTable';
export type { RequestTableProps } from './RequestTable';

export { RequestDetailModal } from './RequestDetailModal';
export type { RequestDetailModalProps } from './RequestDetailModal';

export { NewRequestModal } from './NewRequestModal';
export type { NewRequestModalProps } from './NewRequestModal';

export { ConsentManager } from './ConsentManager';
export type { ConsentManagerProps } from './ConsentManager';

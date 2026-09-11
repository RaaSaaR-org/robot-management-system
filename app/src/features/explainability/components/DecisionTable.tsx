/**
 * @file DecisionTable.tsx
 * @description AI decisions as a kit DataTable with server pagination
 * @feature explainability
 */

import { Brain, Search } from 'lucide-react';
import {
  Button,
  DataTable,
  EmptyState,
  Panel,
  type DataTableColumn,
} from '@/shared/components/ui';
import { ConfidenceGauge } from './ConfidenceGauge';
import { SafetyBadge } from './SafetyBadge';
import { DECISION_TYPE_LABELS, formatDate, type DecisionExplanation } from '../types';

export interface DecisionTableProps {
  rows: DecisionExplanation[];
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
  onOpen: (decision: DecisionExplanation) => void;
  hasFilters: boolean;
  onClearFilters: () => void;
  page: number;
  totalPages: number;
  total: number;
  onPageChange: (page: number) => void;
}

const COLUMNS: DataTableColumn<DecisionExplanation>[] = [
  {
    key: 'createdAt',
    header: 'Time',
    sortable: true,
    sortValue: (d) => new Date(d.createdAt),
    cell: (d) => <span className="whitespace-nowrap text-[13px] text-ink-tertiary">{formatDate(d.createdAt)}</span>,
  },
  {
    key: 'decision',
    header: 'Decision',
    cell: (d) => (
      <div className="min-w-0">
        <div className="truncate text-sm text-ink-primary">{d.inputFactors.userCommand || 'No command recorded'}</div>
        <div className="text-[13px] text-ink-tertiary">{DECISION_TYPE_LABELS[d.decisionType] ?? d.decisionType}</div>
      </div>
    ),
  },
  {
    key: 'robotId',
    header: 'Robot',
    hideBelow: 'sm',
    cell: (d) => <span className="font-mono text-[13px] text-ink-secondary" title={d.robotId}>{d.robotId}</span>,
  },
  {
    key: 'confidence',
    header: 'Confidence',
    align: 'right',
    sortable: true,
    sortValue: (d) => d.confidence,
    cell: (d) => <ConfidenceGauge confidence={d.confidence} />,
  },
  {
    key: 'safety',
    header: 'Safety',
    hideBelow: 'md',
    cell: (d) => <SafetyBadge classification={d.safetyFactors.classification} />,
  },
];

export function DecisionTable(props: DecisionTableProps) {
  const { rows, isLoading, error, onRetry, onOpen, hasFilters, onClearFilters } = props;
  return (
    <Panel padding="none">
      <DataTable
        caption="AI decisions"
        columns={COLUMNS}
        rows={rows}
        getRowId={(d) => d.id}
        defaultSort={{ key: 'createdAt', direction: 'desc' }}
        onRowClick={onOpen}
        isLoading={isLoading}
        error={error}
        errorTitle="Couldn't load AI decisions"
        onRetry={onRetry}
        pagination={{ page: props.page, totalPages: props.totalPages, total: props.total, onPageChange: props.onPageChange }}
        empty={
          hasFilters ? (
            <EmptyState
              icon={<Search />}
              title="No decisions match"
              description="Try another command or robot, or clear the filters."
              action={<Button variant="secondary" onClick={onClearFilters}>Clear filters</Button>}
            />
          ) : (
            <EmptyState
              icon={<Brain />}
              title="No AI decisions logged yet"
              description="Decisions appear here when a robot agent acts on a command."
            />
          )
        }
      />
    </Panel>
  );
}

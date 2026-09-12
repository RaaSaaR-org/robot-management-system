/**
 * @file ExplainabilityPage.tsx
 * @description Explainability section of /compliance: decisions, performance, documentation (?view=)
 * @feature explainability
 */

import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Eye, RefreshCw } from 'lucide-react';
import { DemoFeaturePlaceholder } from '@/components/demo/DemoFeaturePlaceholder';
import { Button, SearchInput, SegmentedControl, Select, Toolbar } from '@/shared/components/ui';
import { DecisionTable } from '../components/DecisionTable';
import { DecisionModal } from '../components/DecisionModal';
import { PerformanceDashboard } from '../components/PerformanceDashboard';
import { DocumentationPortal } from '../components/DocumentationPortal';
import { useDecisions } from '../hooks/useDecisions';
import { useMetrics } from '../hooks/useMetrics';
import { useDocumentation } from '../hooks/useDocumentation';
import {
  DECISION_TYPE_LABELS,
  METRICS_PERIOD_LABELS,
  type DecisionExplanation,
  type DecisionType,
  type MetricsPeriod,
} from '../types';

type View = 'decisions' | 'performance' | 'documentation';
const VIEWS: { value: View; label: string }[] = [
  { value: 'decisions', label: 'Decisions' },
  { value: 'performance', label: 'Performance' },
  { value: 'documentation', label: 'Documentation' },
];
const TYPE_OPTIONS = (Object.keys(DECISION_TYPE_LABELS) as DecisionType[]).map((t) => ({
  value: t,
  label: DECISION_TYPE_LABELS[t],
}));
const PERIOD_OPTIONS = (Object.keys(METRICS_PERIOD_LABELS) as MetricsPeriod[]).map((p) => ({
  value: p,
  label: METRICS_PERIOD_LABELS[p],
}));

/** AI explainability (EU AI Act Art. 13/86), hosted as a tab section. */
export function ExplainabilityPage() {
  if (import.meta.env.VITE_DEMO_MODE === 'true') {
    return (
      <DemoFeaturePlaceholder
        featureName="AI Explainability"
        icon={<Eye className="w-12 h-12" />}
        description="Understand what your robot AI is doing and why. Visualize attention maps, action explanations, and decision traces."
        capabilities={[
          'Visualize VLA attention maps during inference',
          'Explain individual robot actions in natural language',
          'Audit model decisions for compliance',
          'Detect and alert on anomalous behavior patterns',
        ]}
        docsSlug="architecture"
      />
    );
  }
  return <ExplainabilitySection />;
}

function ExplainabilitySection() {
  const [params, setParams] = useSearchParams();
  const view = VIEWS.some((v) => v.value === params.get('view')) ? (params.get('view') as View) : VIEWS[0].value;
  const setView = (v: View) =>
    setParams((p) => { if (v === VIEWS[0].value) p.delete('view'); else p.set('view', v); return p; }, { replace: true });

  const [query, setQuery] = useState('');
  const [decisionType, setDecisionType] = useState<DecisionType | ''>('');
  const [period, setPeriod] = useState<MetricsPeriod>('weekly');
  const [open, setOpen] = useState<DecisionExplanation | null>(null);

  const d = useDecisions({ autoFetch: true, decisionType: decisionType || undefined });
  const m = useMetrics({ autoFetch: view === 'performance', period });
  const doc = useDocumentation({ autoFetch: view === 'documentation' });

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return d.decisions;
    return d.decisions.filter((x) =>
      [x.inputFactors.userCommand, x.robotId, x.modelUsed].some((v) => v?.toLowerCase().includes(q)),
    );
  }, [d.decisions, query]);

  const refresh = () => {
    if (view === 'decisions') void d.fetchDecisions(d.pagination.page);
    else if (view === 'performance') void m.fetchMetrics(period);
    else void doc.fetchDocumentation();
  };

  const switcher = (
    <div className="max-w-full overflow-x-auto">
      <SegmentedControl label="Explainability view" size="sm" options={VIEWS} value={view} onChange={setView} />
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {switcher}
      <Toolbar
        search={view === 'decisions' ? <SearchInput value={query} onChange={setQuery} placeholder="Search command or robot" /> : undefined}
        filters={
          <>
            {view === 'decisions' && (
              <Select aria-label="Decision type" fullWidth={false} className="w-48" placeholder="All decision types"
                options={TYPE_OPTIONS} value={decisionType} onChange={(e) => setDecisionType(e.target.value as DecisionType | '')} />
            )}
            {view === 'performance' && (
              <Select aria-label="Period" fullWidth={false} className="w-40" options={PERIOD_OPTIONS} value={period}
                onChange={(e) => { const p = e.target.value as MetricsPeriod; setPeriod(p); void m.fetchMetrics(p); }} />
            )}
          </>
        }
        actions={
          <Button variant="ghost" size="sm" iconOnly aria-label="Refresh" onClick={refresh}>
            <RefreshCw className="h-4 w-4" strokeWidth={1.75} />
          </Button>
        }
      />

      {view === 'decisions' && (
        <DecisionTable
          rows={rows}
          isLoading={d.isLoading}
          error={d.decisions.length ? null : d.error}
          onRetry={() => void d.fetchDecisions()}
          onOpen={setOpen}
          hasFilters={Boolean(query || decisionType)}
          onClearFilters={() => { setQuery(''); setDecisionType(''); }}
          page={d.pagination.page}
          totalPages={d.pagination.totalPages}
          total={d.pagination.total}
          onPageChange={(p) => void d.fetchDecisions(p)}
        />
      )}
      {view === 'performance' && (
        <PerformanceDashboard metrics={m.metrics} isLoading={m.isLoading} error={m.error} onRetry={() => void m.fetchMetrics(period)} />
      )}
      {view === 'documentation' && (
        <DocumentationPortal documentation={doc.documentation} isLoading={doc.isLoading} error={doc.error} onRetry={() => void doc.fetchDocumentation()} />
      )}

      <DecisionModal
        decision={open}
        explanation={d.formattedExplanation}
        isLoadingExplanation={d.isLoadingExplanation}
        onLoadExplanation={d.fetchExplanation}
        onClose={() => setOpen(null)}
      />
    </div>
  );
}

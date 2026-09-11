/**
 * @file ObligationsSection.tsx
 * @description Obligations tab: deadlines, gap analysis, risk assessments,
 *              inspections, training, documents and technical docs, switched
 *              through ?view=.
 * @feature compliance
 */

import { useSearchParams } from 'react-router-dom';
import { SegmentedControl } from '@/shared/components/ui';
import { RegulatoryTimeline } from './RegulatoryTimeline';
import { GapAnalysisPanel } from './GapAnalysisPanel';
import { RiskAssessmentTracker } from './RiskAssessmentTracker';
import { InspectionSchedulePanel } from './InspectionSchedulePanel';
import { TrainingCompliancePanel } from './TrainingCompliancePanel';
import { DocumentExpiryList } from './DocumentExpiryList';
import { ProviderDocsTab } from './ProviderDocsTab';

const VIEWS = [
  { value: 'deadlines', label: 'Deadlines' },
  { value: 'gaps', label: 'Gap analysis' },
  { value: 'risk', label: 'Risk assessments' },
  { value: 'inspections', label: 'Inspections' },
  { value: 'training', label: 'Training' },
  { value: 'documents', label: 'Documents' },
  { value: 'technical-docs', label: 'Technical docs' },
] as const;

type View = (typeof VIEWS)[number]['value'];

export function ObligationsSection() {
  const [params, setParams] = useSearchParams();
  const view: View = VIEWS.some((v) => v.value === params.get('view')) ? (params.get('view') as View) : VIEWS[0].value;
  const setView = (v: View) =>
    setParams(
      (p) => {
        if (v === VIEWS[0].value) p.delete('view');
        else p.set('view', v);
        return p;
      },
      { replace: true },
    );

  return (
    <div className="flex flex-col gap-4">
      <div className="max-w-full overflow-x-auto">
        <SegmentedControl label="Obligations view" size="sm" options={[...VIEWS]} value={view} onChange={setView} />
      </div>
      {view === 'deadlines' && <RegulatoryTimeline />}
      {view === 'gaps' && <GapAnalysisPanel />}
      {view === 'risk' && <RiskAssessmentTracker />}
      {view === 'inspections' && <InspectionSchedulePanel />}
      {view === 'training' && <TrainingCompliancePanel />}
      {view === 'documents' && <DocumentExpiryList />}
      {view === 'technical-docs' && <ProviderDocsTab />}
    </div>
  );
}

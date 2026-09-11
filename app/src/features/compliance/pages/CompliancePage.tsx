/**
 * @file CompliancePage.tsx
 * @description The compliance page: one header and seven tabs in the URL —
 *              overview, obligations, audit trail, explainability, oversight,
 *              approvals and data privacy.
 * @feature compliance
 */

import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download, RefreshCw, Shield } from 'lucide-react';
import { DemoFeaturePlaceholder } from '@/components/demo/DemoFeaturePlaceholder';
import { Button, InfoIcon, PageHeader, Tabs } from '@/shared/components/ui';
import { ExplainabilityPage } from '@/features/explainability/pages/ExplainabilityPage';
import { OversightPage } from '@/features/oversight/pages/OversightPage';
import { ApprovalsPage } from '@/features/approvals/pages/ApprovalsPage';
import { GDPRPortalPage } from '@/features/gdpr/pages/GDPRPortalPage';
import { ComplianceDashboard } from '../components/ComplianceDashboard';
import { ObligationsSection } from '../components/ObligationsSection';
import { AuditLogSection } from '../components/AuditLogSection';
import { ExportDialog } from '../components/ExportDialog';
import { useComplianceTrackerStore } from '../store/complianceTrackerStore';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'obligations', label: 'Obligations' },
  { id: 'audit', label: 'Audit trail' },
  { id: 'explainability', label: 'Explainability' },
  { id: 'oversight', label: 'Oversight' },
  { id: 'approvals', label: 'Approvals' },
  { id: 'privacy', label: 'Data privacy' },
] as const;

type TabId = (typeof TABS)[number]['id'];

/** Legacy ?tab= ids → the tab (and view) they live in now. */
const TAB_ALIASES: Record<string, { tab: TabId; view?: string }> = {
  dashboard: { tab: 'overview' },
  logs: { tab: 'audit' },
  integrity: { tab: 'audit', view: 'integrity' },
  metrics: { tab: 'audit', view: 'metrics' },
  settings: { tab: 'audit', view: 'retention' },
  ropa: { tab: 'privacy', view: 'ropa' },
  'technical-docs': { tab: 'obligations', view: 'technical-docs' },
  gdpr: { tab: 'privacy' },
};

const DESCRIPTION = 'Audit trail, human oversight and data-protection records for the EU AI Act and GDPR.';

const EXPLAINER =
  'NeoDEM keeps a cryptographically chained, tamper-evident record of every AI decision, safety action and command. ' +
  'Use it to audit decisions, verify that no entry was altered, meet the EU AI Act record-keeping duty (Art. 12) ' +
  'and investigate incidents with a complete trail.';

function Header({ actions }: { actions?: React.ReactNode }) {
  return (
    <PageHeader
      eyebrow="Comply"
      title="Compliance"
      description={
        <span className="inline-flex flex-wrap items-center gap-1.5">
          {DESCRIPTION}
          <InfoIcon content={EXPLAINER} label="About compliance logging" maxWidth={320} />
        </span>
      }
      actions={actions}
    />
  );
}

/**
 * Compliance (EU AI Act Art. 12–14, GDPR Art. 15–30)
 */
export function CompliancePage() {
  if (import.meta.env.VITE_DEMO_MODE === 'true') {
    return (
      <div className="flex flex-col gap-6">
        <Header />
        <DemoFeaturePlaceholder
          featureName="Compliance Center"
          icon={<Shield className="w-12 h-12" />}
          description="Ensure your robot fleet meets EU AI Act, ISO 10218, and industry-specific safety standards with automated compliance tracking."
          capabilities={[
            'Automated EU AI Act compliance checks',
            'ISO 10218 safety standard monitoring',
            'Audit trail for all robot decisions and actions',
            'Generate compliance reports for regulators',
          ]}
          docsSlug="regulatory-compliance"
        />
      </div>
    );
  }

  return <CompliancePageInner />;
}

function CompliancePageInner() {
  const [params, setParams] = useSearchParams();
  const [exportOpen, setExportOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const refreshAll = useComplianceTrackerStore((s) => s.refreshAll);

  const rawTab = params.get('tab');
  const alias = rawTab ? TAB_ALIASES[rawTab] : undefined;

  // Rewrite legacy ids once, so old links and redirects land on the new tab.
  useEffect(() => {
    if (!alias) return;
    setParams(
      (p) => {
        if (alias.tab === 'overview') p.delete('tab');
        else p.set('tab', alias.tab);
        if (alias.view) p.set('view', alias.view);
        return p;
      },
      { replace: true },
    );
  }, [alias, setParams]);

  const tab: TabId = alias?.tab ?? (TABS.some((t) => t.id === rawTab) ? (rawTab as TabId) : 'overview');

  const setTab = (id: string) =>
    setParams(
      (p) => {
        if (id === TABS[0].id) p.delete('tab');
        else p.set('tab', id);
        p.delete('view');
        return p;
      },
      { replace: true },
    );

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshAll();
    } finally {
      setRefreshing(false);
    }
  };

  let actions: React.ReactNode = null;
  if (tab === 'audit') {
    actions = (
      <Button variant="secondary" leftIcon={<Download className="w-4 h-4" strokeWidth={1.75} />} onClick={() => setExportOpen(true)}>
        Export log
      </Button>
    );
  } else if (tab === 'overview' || tab === 'obligations') {
    actions = (
      <Button variant="ghost" iconOnly aria-label="Refresh" isLoading={refreshing} onClick={() => void handleRefresh()}>
        <RefreshCw className="w-4 h-4" strokeWidth={1.75} />
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Header actions={actions} />
      <Tabs label="Compliance sections" tabs={TABS.map(({ id, label }) => ({ id, label }))} activeTab={tab} onTabChange={setTab} />

      {tab === 'overview' && <ComplianceDashboard />}
      {tab === 'obligations' && <ObligationsSection />}
      {tab === 'audit' && <AuditLogSection onViewDecision={() => setTab('explainability')} />}
      {tab === 'explainability' && <ExplainabilityPage />}
      {tab === 'oversight' && <OversightPage />}
      {tab === 'approvals' && <ApprovalsPage />}
      {tab === 'privacy' && <GDPRPortalPage />}

      <ExportDialog isOpen={exportOpen} onClose={() => setExportOpen(false)} />
    </div>
  );
}

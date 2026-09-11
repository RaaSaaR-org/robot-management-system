/**
 * @file DocumentationPortal.tsx
 * @description AI system documentation (EU AI Act Art. 13) as calm kit panels
 * @feature explainability
 */

import { FileText } from 'lucide-react';
import { EmptyState, ErrorState, KeyValueList, Panel, SkeletonText } from '@/shared/components/ui';
import type { AIDocumentation } from '../types';

export interface DocumentationPortalProps {
  documentation: AIDocumentation | null;
  isLoading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}

function ListPanel({ title, description, items }: { title: string; description: string; items: string[] }) {
  return (
    <Panel>
      <Panel.Header title={title} description={description} />
      <Panel.Body>
        {items.length ? (
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink-secondary">
            {items.map((item, i) => <li key={i}>{item}</li>)}
          </ul>
        ) : (
          <p className="text-sm text-ink-tertiary">Nothing documented.</p>
        )}
      </Panel.Body>
    </Panel>
  );
}

export function DocumentationPortal({ documentation, isLoading, error, onRetry }: DocumentationPortalProps) {
  if (isLoading && !documentation) {
    return <Panel><SkeletonText lines={5} /></Panel>;
  }
  if (error && !documentation) {
    return <Panel><ErrorState title="Couldn't load the documentation" message={error} onRetry={onRetry} /></Panel>;
  }
  if (!documentation) {
    return (
      <Panel>
        <EmptyState icon={<FileText />} title="No documentation yet" description="The AI system's Art. 13 documentation appears here once the server provides it." />
      </Panel>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Panel>
        <Panel.Header
          title="AI system"
          description="Provided under EU AI Act Art. 13 (information to deployers) and Art. 50 (transparency)."
        />
        <Panel.Body className="flex flex-col gap-4">
          <p className="max-w-[70ch] text-sm text-ink-secondary">{documentation.intendedPurpose}</p>
          <KeyValueList
            columns={2}
            items={[
              { label: 'Version', value: documentation.version },
              { label: 'Last updated', value: documentation.lastUpdated },
            ]}
          />
        </Panel.Body>
      </Panel>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ListPanel title="Capabilities" description="What the system is built to do" items={documentation.capabilities} />
        <ListPanel title="Known limitations" description="Where it can fail or should not be used" items={documentation.limitations} />
        <ListPanel title="Operating conditions" description="The conditions it was validated for" items={documentation.operatingConditions} />
        <ListPanel title="Human oversight" description="What operators must do (Art. 14)" items={documentation.humanOversightRequirements} />
      </div>
    </div>
  );
}

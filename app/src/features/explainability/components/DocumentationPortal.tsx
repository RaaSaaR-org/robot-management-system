/**
 * @file DocumentationPortal.tsx
 * @description Portal for viewing AI system documentation
 * @feature explainability
 */

import { cn } from '@/shared/utils/cn';
import { Card } from '@/shared/components/ui/Card';
import type { AIDocumentation } from '../types';

export interface DocumentationPortalProps {
  documentation: AIDocumentation | null;
  isLoading?: boolean;
  className?: string;
}

interface SectionProps {
  title: string;
  items: string[];
  variant?: 'default' | 'warning' | 'info';
}

function Section({ title, items, variant = 'default' }: SectionProps) {
  const variantStyles = {
    default: 'border-gray-700',
    warning: 'border-yellow-500/30 bg-yellow-500/5',
    info: 'border-blue-500/30 bg-blue-500/5',
  };

  const iconStyles = {
    default: 'text-theme-tertiary',
    warning: 'text-yellow-400',
    info: 'text-blue-400',
  };

  return (
    <Card className={cn('glass-card p-4', variantStyles[variant])}>
      <h4 className={cn('font-medium mb-3', iconStyles[variant])}>{title}</h4>
      <ul className="space-y-2">
        {items.map((item, index) => (
          <li key={index} className="flex gap-2 text-sm text-theme-secondary">
            <span className={iconStyles[variant]}>-</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/**
 * Portal for AI system documentation
 *
 * @example
 * ```tsx
 * <DocumentationPortal documentation={documentation} />
 * ```
 */
export function DocumentationPortal({
  documentation,
  isLoading,
  className,
}: DocumentationPortalProps) {
  if (isLoading) {
    return (
      <div className={cn('space-y-4', className)}>
        <div className="animate-pulse">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="glass-card p-4 mb-4">
              <div className="h-4 bg-gray-700 rounded w-32 mb-3" />
              <div className="space-y-2">
                <div className="h-3 bg-gray-700 rounded w-full" />
                <div className="h-3 bg-gray-700 rounded w-3/4" />
              </div>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (!documentation) {
    return (
      <Card className={cn('glass-card p-6 text-center', className)}>
        <p className="text-theme-secondary">Documentation not available</p>
      </Card>
    );
  }

  return (
    <div className={cn('space-y-4', className)}>
      {/* Header */}
      <Card className="glass-card p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-theme-primary">AI System Documentation</h3>
          <span className="text-sm text-theme-tertiary">v{documentation.version}</span>
        </div>
        <div className="space-y-3">
          <div>
            <h4 className="text-sm font-medium text-theme-secondary mb-1">Intended Purpose</h4>
            <p className="text-theme-primary">{documentation.intendedPurpose}</p>
          </div>
          <p className="text-xs text-theme-tertiary">
            Last updated: {documentation.lastUpdated}
          </p>
        </div>
      </Card>

      {/* Capabilities */}
      <Section title="Capabilities" items={documentation.capabilities} variant="info" />

      {/* Limitations */}
      <Section title="Known Limitations" items={documentation.limitations} variant="warning" />

      {/* Operating Conditions */}
      <Section title="Operating Conditions" items={documentation.operatingConditions} />

      {/* Human Oversight */}
      <Section
        title="Human Oversight Requirements"
        items={documentation.humanOversightRequirements}
        variant="warning"
      />

      {/* Compliance Notice */}
      <Card className="glass-card p-4 border-primary-500/30 bg-primary-500/5">
        <h4 className="font-medium text-primary-400 mb-2">EU AI Act Compliance</h4>
        <p className="text-sm text-theme-secondary">
          This documentation is provided in accordance with EU AI Act Article 13 (Transparency and
          provision of information to deployers) and Article 50 (Transparency obligations for
          providers and deployers of certain AI systems).
        </p>
      </Card>
    </div>
  );
}

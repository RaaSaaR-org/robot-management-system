/**
 * @file DemoFeaturePlaceholder.tsx
 * @description Placeholder component for features disabled in demo mode
 * @feature demo
 */

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

// ============================================================================
// TYPES
// ============================================================================

export interface DemoFeaturePlaceholderProps {
  featureName: string;
  icon: ReactNode;
  description: string;
  capabilities: string[];
  docsSlug?: string;
}

// ============================================================================
// COMPONENT
// ============================================================================

export function DemoFeaturePlaceholder({
  featureName,
  icon,
  description,
  capabilities,
  docsSlug,
}: DemoFeaturePlaceholderProps) {
  return (
    <div className="flex items-center justify-center min-h-[calc(100vh-3.5rem)] p-4">
      <div className="max-w-[600px] w-full text-center">
        {/* Icon */}
        <div className="flex justify-center mb-6 text-theme-secondary opacity-60">
          {icon}
        </div>

        {/* Feature name */}
        <h2 className="text-2xl font-bold text-theme-primary mb-3">{featureName}</h2>

        {/* Demo badge */}
        <span className="inline-block px-3 py-1 text-xs font-medium rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 mb-4">
          Demo &mdash; Not Available
        </span>

        {/* Description */}
        <p className="text-theme-secondary mb-6 leading-relaxed">{description}</p>

        {/* Capabilities */}
        <ul className="text-left space-y-2 mb-8 mx-auto max-w-md">
          {capabilities.map((cap) => (
            <li key={cap} className="flex items-start gap-2 text-theme-secondary text-sm">
              <svg
                className="w-4 h-4 mt-0.5 flex-shrink-0 text-cobalt"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
              {cap}
            </li>
          ))}
        </ul>

        {/* Buttons */}
        <div className="flex items-center justify-center gap-3">
          <Link
            to={docsSlug ? `/docs/${docsSlug}` : '/docs'}
            className="px-4 py-2 text-sm font-medium rounded-brand bg-cobalt text-white hover:bg-cobalt-600 transition-colors"
          >
            View Docs
          </Link>
          <a
            href="https://github.com/RaaSaaR-org/robot-management-system"
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 text-sm font-medium rounded-brand border border-theme text-theme-secondary hover:text-theme-primary hover:bg-theme-card transition-colors"
          >
            Learn More
          </a>
        </div>
      </div>
    </div>
  );
}

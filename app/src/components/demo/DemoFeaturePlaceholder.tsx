/**
 * @file DemoFeaturePlaceholder.tsx
 * @description Calm "not in the demo" page for features that need a real server:
 *              a PageHeader (the page's only h1) and one panel listing what the
 *              feature does in a real deployment.
 * @feature demo
 */

import {
  cloneElement,
  isValidElement,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react';
import { useLocation } from 'react-router-dom';
import { BookOpen, Check } from 'lucide-react';
import { LinkButton, PageHeader, Panel, StatusTag } from '@/shared/components/ui';
import { NAV_GROUPS, isNavItemActive } from '@/components/layout/navigation';

// ============================================================================
// TYPES
// ============================================================================

export interface DemoFeaturePlaceholderProps {
  featureName: string;
  icon: ReactNode;
  description: string;
  capabilities: string[];
  docsSlug?: string;
  /**
   * Navigation group shown above the title. Defaults to the sidebar group that
   * owns the current route (e.g. "Comply" on /compliance), else "Operate".
   */
  eyebrow?: string;
}

// ============================================================================
// HELPERS
// ============================================================================

/** The sidebar group label for a pathname, so the eyebrow matches the nav. */
function navGroupFor(pathname: string): string | undefined {
  return NAV_GROUPS.find((g) => g.items.some((item) => isNavItemActive(item, pathname)))?.label;
}

/**
 * True when the page around the placeholder already has an h1 — it is a tab of
 * another page (Alerts > Incidents). Then it renders as a panel instead of a
 * page, so the page keeps exactly one h1. Measured before the first paint.
 */
function useEmbeddedInPage(ref: RefObject<HTMLElement | null>): boolean {
  const [embedded, setEmbedded] = useState(false);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const scope = root.closest('main') ?? document.body;
    setEmbedded(Array.from(scope.querySelectorAll('h1')).some((h) => !root.contains(h)));
  }, [ref]);
  return embedded;
}

/** Normalises whatever icon a page passes (often w-12 h-12) to the 20px tile size. */
function tileIcon(icon: ReactNode): ReactNode {
  if (!isValidElement(icon)) return icon;
  return cloneElement(icon as ReactElement<{ className?: string; strokeWidth?: number }>, {
    className: 'h-5 w-5',
    strokeWidth: 1.75,
  });
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
  eyebrow,
}: DemoFeaturePlaceholderProps) {
  const { pathname } = useLocation();
  const group = eyebrow ?? navGroupFor(pathname) ?? 'Operate';
  const rootRef = useRef<HTMLDivElement>(null);
  const embedded = useEmbeddedInPage(rootRef);
  const docsTo = docsSlug ? `/docs/${docsSlug}` : '/docs';
  const docsIcon = <BookOpen className="h-4 w-4" strokeWidth={1.75} />;
  // data-demo-badge lets marketing screenshots hide the tag.
  const demoTag = (
    <span data-demo-badge>
      <StatusTag tone="gated">Not in the demo</StatusTag>
    </span>
  );

  return (
    <div ref={rootRef} className="flex flex-col gap-6">
      {!embedded && (
        <PageHeader
          eyebrow={group}
          title={featureName}
          description={description}
          meta={demoTag}
          actions={
            <LinkButton to={docsTo} leftIcon={docsIcon}>
              Read the docs
            </LinkButton>
          }
        />
      )}

      <Panel className="max-w-3xl">
        <Panel.Header
          title={embedded ? featureName : 'What it does in a real deployment'}
          description={embedded ? description : undefined}
          actions={
            embedded ? (
              <>
                {demoTag}
                <LinkButton to={docsTo} variant="secondary" size="sm" leftIcon={docsIcon}>
                  Read the docs
                </LinkButton>
              </>
            ) : (
              <span
                aria-hidden="true"
                className="flex h-10 w-10 items-center justify-center rounded-control border border-line bg-inset text-ink-tertiary"
              >
                {tileIcon(icon)}
              </span>
            )
          }
        />
        <Panel.Body className="flex flex-col gap-4">
          <ul className="flex flex-col gap-2.5">
            {capabilities.map((cap) => (
              <li key={cap} className="flex items-start gap-2.5 text-sm text-ink-secondary">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" strokeWidth={1.75} aria-hidden="true" />
                <span>{cap}</span>
              </li>
            ))}
          </ul>
          <p className="text-[13px] text-ink-tertiary">Run NeoDEM against a real server to use it.</p>
        </Panel.Body>
      </Panel>
    </div>
  );
}

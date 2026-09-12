/**
 * @file RouteErrorBoundary.test.tsx
 * @description A page that throws must degrade to the ErrorState panel with the
 *              app shell still mounted — never a blank tree (TASK-300).
 * @feature shared
 */

import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RouteErrorBoundary } from '../RouteErrorBoundary';

function Boom(): React.ReactElement {
  throw new Error('robots is not iterable');
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <nav aria-label="Sidebar">Fleet</nav>
      <main>{children}</main>
    </div>
  );
}

// React logs the caught error itself; silence it so the run stays readable.
const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});

afterEach(() => quiet.mockClear());

describe('RouteErrorBoundary', () => {
  it('shows the error panel and keeps the shell mounted', () => {
    render(
      <Shell>
        <RouteErrorBoundary>
          <Boom />
        </RouteErrorBoundary>
      </Shell>
    );

    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't show this page");
    expect(screen.getByText('robots is not iterable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload the page' })).toBeInTheDocument();
    // The shell outside the boundary survived the throw.
    expect(screen.getByRole('navigation', { name: 'Sidebar' })).toBeInTheDocument();
  });

  it('renders its children untouched when nothing throws', () => {
    render(
      <RouteErrorBoundary>
        <p>Fleet map</p>
      </RouteErrorBoundary>
    );

    expect(screen.getByText('Fleet map')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('clears the caught error when the reset key changes', () => {
    const { rerender } = render(
      <RouteErrorBoundary resetKey="/broken">
        <Boom />
      </RouteErrorBoundary>
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();

    // Navigating elsewhere: same boundary, new URL, healthy page.
    rerender(
      <RouteErrorBoundary resetKey="/dashboard">
        <p>Dashboard</p>
      </RouteErrorBoundary>
    );

    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

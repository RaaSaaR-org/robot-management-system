/**
 * @file RouteErrorBoundary.tsx
 * @description Catches a render error thrown by a page so the app shell — the
 *              sidebar, the top bar, the route the user came from — survives it
 *              and the user sees the ErrorState panel instead of a blank tree.
 * @feature shared
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ErrorState } from './ErrorState';

export interface RouteErrorBoundaryProps {
  children: ReactNode;
  /**
   * Change this to clear a caught error — pass the current URL and navigating
   * away from the broken page is enough to recover, with no reload.
   */
  resetKey?: string;
  /** Headline of the panel (default "Couldn't show this page") */
  title?: ReactNode;
}

interface RouteErrorBoundaryState {
  error: Error | null;
}

/**
 * @example
 * ```tsx
 * <AppLayout>
 *   <RouteErrorBoundary resetKey={location.pathname}>{children}</RouteErrorBoundary>
 * </AppLayout>
 * ```
 */
export class RouteErrorBoundary extends Component<
  RouteErrorBoundaryProps,
  RouteErrorBoundaryState
> {
  state: RouteErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): RouteErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(
      'Page render failed:',
      error.message,
      info.componentStack?.split('\n')[1]?.trim()
    );
  }

  componentDidUpdate(previous: RouteErrorBoundaryProps): void {
    if (this.state.error && previous.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    const { children, title = "Couldn't show this page" } = this.props;
    const { error } = this.state;

    if (!error) return children;

    return (
      <ErrorState
        title={title}
        message={error.message}
        size="lg"
        retryLabel="Reload the page"
        onRetry={() => window.location.reload()}
      />
    );
  }
}

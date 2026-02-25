/**
 * @file utils.tsx
 * @description Test utilities with provider wrappers
 */

import { type ReactElement, type ReactNode } from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import { MemoryRouter, type MemoryRouterProps } from 'react-router-dom';
import { ThemeProvider } from '@/app/providers/ThemeProvider';
import { AuthProvider } from '@/app/providers/AuthProvider';

interface WrapperOptions {
  /** Initial route entries for MemoryRouter */
  routerEntries?: MemoryRouterProps['initialEntries'];
  /** Whether to include AuthProvider (default: true) */
  withAuth?: boolean;
}

/**
 * Create a wrapper with all necessary providers for testing
 */
function createWrapper(options: WrapperOptions = {}) {
  const { routerEntries = ['/'], withAuth = true } = options;

  return function TestWrapper({ children }: { children: ReactNode }) {
    const content = (
      <MemoryRouter initialEntries={routerEntries}>
        <ThemeProvider>
          {children}
        </ThemeProvider>
      </MemoryRouter>
    );

    if (withAuth) {
      return (
        <MemoryRouter initialEntries={routerEntries}>
          <ThemeProvider>
            <AuthProvider showLoadingSpinner={false}>
              {children}
            </AuthProvider>
          </ThemeProvider>
        </MemoryRouter>
      );
    }

    return content;
  };
}

/**
 * Render a component with all providers (Router, Theme, Auth)
 */
export function renderWithProviders(
  ui: ReactElement,
  options: WrapperOptions & Omit<RenderOptions, 'wrapper'> = {},
) {
  const { routerEntries, withAuth, ...renderOptions } = options;
  return render(ui, {
    wrapper: createWrapper({ routerEntries, withAuth }),
    ...renderOptions,
  });
}

// Re-export testing library utilities
export { screen, within, waitFor, act } from '@testing-library/react';
export { default as userEvent } from '@testing-library/user-event';

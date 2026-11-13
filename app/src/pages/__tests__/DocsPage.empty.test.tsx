/**
 * @file DocsPage.empty.test.tsx
 * @description A build that bundled no document says so. It used to redirect
 *              /docs to "/docs/" — an empty slug — and render a blank main
 *              area behind the help button (TASK-486).
 * @feature docs
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('@/components/docs/docsRegistry', () => ({
  DEFAULT_SLUG: '',
  DOC_CONTENT: new Map<string, string>(),
  DOC_ENTRIES: [],
  DOC_GROUPS: new Map(),
  GITHUB_DOCS_URL: 'https://example.test/docs',
  ORDERED_CATEGORIES: [],
}));

import { DocsPage } from '../DocsPage';

describe('DocsPage without bundled docs', () => {
  it.each(['/docs', '/docs/'])('explains itself at %s instead of rendering nothing', (path) => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/docs" element={<DocsPage />} />
          <Route path="/docs/*" element={<DocsPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Documentation' })).toBeInTheDocument();
    expect(screen.getByText('Documentation is not available here')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open the docs on GitHub/ })).toHaveAttribute('href', 'https://example.test/docs');
  });
});

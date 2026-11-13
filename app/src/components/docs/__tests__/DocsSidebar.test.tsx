/**
 * @file DocsSidebar.test.tsx
 * @description The count under the docs list is the number of documents the
 *              list offers. It said "49 documents" — every file under docs/ —
 *              over a list of 32: decision records and ADRs are bundled so
 *              links to them resolve, but have no category in the sidebar
 *              (TASK-493).
 * @feature docs
 */

import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DocsSidebar } from '../DocsSidebar';
import { DOC_CONTENT, DOC_ENTRIES, DOC_GROUPS, ORDERED_CATEGORIES } from '../docsRegistry';

function renderSidebar() {
  return render(
    <MemoryRouter>
      <DocsSidebar docs={DOC_ENTRIES} groups={DOC_GROUPS} categories={ORDERED_CATEGORIES} contentMap={DOC_CONTENT} />
    </MemoryRouter>,
  );
}

const count = () => Number(screen.getByTestId('docs-count').textContent?.match(/^\s*(\d+)/)?.[1]);

describe('the docs sidebar count', () => {
  it('counts the documents the list links to, not every bundled file', () => {
    renderSidebar();
    const links = screen.getAllByRole('link');
    expect(count()).toBe(links.length);
    expect(screen.getByTestId('docs-count')).toHaveTextContent(new RegExp(`^${links.length} documents$`));
    // The premise of the defect: more files are bundled than the list shows.
    expect(DOC_ENTRIES.length).toBeGreaterThan(links.length);
  });

  it('counts the matches while searching, and says so', () => {
    renderSidebar();
    fireEvent.change(screen.getByPlaceholderText('Search docs'), { target: { value: 'demo fleet' } });
    const links = screen.getAllByRole('link');
    expect(links.length).toBeGreaterThan(0);
    expect(links.length).toBeLessThan(DOC_ENTRIES.length);
    expect(screen.getByTestId('docs-count')).toHaveTextContent(
      new RegExp(`^${links.length} ${links.length === 1 ? 'document' : 'documents'} match$`),
    );
  });

  it('says zero when nothing matches', () => {
    renderSidebar();
    fireEvent.change(screen.getByPlaceholderText('Search docs'), { target: { value: 'zzzz-no-such-text-qqqq' } });
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(screen.getByTestId('docs-count')).toHaveTextContent(/^0 documents match$/);
  });
});

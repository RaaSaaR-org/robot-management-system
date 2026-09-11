/**
 * @file Pager.test.tsx
 * @description Tests for the kit Pager and DataTable's `pagination` and `rowProps`
 * @feature shared
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Pager } from '../Pager';
import { DataTable, type DataTableColumn } from '../DataTable';

describe('Pager', () => {
  it('reads "Page x of y" with the total and a noun', () => {
    render(<Pager page={2} totalPages={7} total={1234} noun="entry" nounPlural="entries" onPageChange={() => {}} />);
    const nav = screen.getByRole('navigation', { name: 'Pagination' });
    expect(nav).toHaveTextContent(`Page 2 of 7 · ${(1234).toLocaleString()} entries`);
  });

  it('pluralises with an s, uses the singular for one, and says "total" without a noun', () => {
    const { rerender } = render(<Pager page={1} totalPages={2} total={3} noun="incident" onPageChange={() => {}} />);
    expect(screen.getByRole('navigation')).toHaveTextContent('3 incidents');
    rerender(<Pager page={1} totalPages={1} total={1} noun="incident" showSinglePage onPageChange={() => {}} />);
    expect(screen.getByRole('navigation')).toHaveTextContent('Page 1 of 1 · 1 incident');
    rerender(<Pager page={1} totalPages={3} total={57} onPageChange={() => {}} />);
    expect(screen.getByRole('navigation')).toHaveTextContent('57 total');
  });

  it('goes to the previous and next page and disables at the ends', async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    const { rerender } = render(<Pager page={1} totalPages={3} onPageChange={onPageChange} />);
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(onPageChange).toHaveBeenLastCalledWith(2);

    rerender(<Pager page={3} totalPages={3} onPageChange={onPageChange} />);
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(onPageChange).toHaveBeenLastCalledWith(2);
  });

  it('disables both buttons while disabled', () => {
    render(<Pager page={2} totalPages={3} disabled onPageChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
  });

  it('renders nothing for a single page unless asked to', () => {
    const { container, rerender } = render(<Pager page={1} totalPages={1} onPageChange={() => {}} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<Pager page={1} totalPages={0} onPageChange={() => {}} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<Pager page={1} totalPages={1} showSinglePage onPageChange={() => {}} />);
    expect(screen.getByRole('navigation')).toHaveTextContent('Page 1 of 1');
  });
});

interface Row {
  id: string;
  name: string;
}
const ROWS: Row[] = [
  { id: 'a', name: 'Alpha' },
  { id: 'b', name: 'Bravo' },
];
const COLUMNS: DataTableColumn<Row>[] = [{ key: 'name', header: 'Name' }];

describe('DataTable pagination', () => {
  it('renders the pager in the footer, outside the scrolling table', async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    render(
      <DataTable
        caption="Rows"
        columns={COLUMNS}
        rows={ROWS}
        getRowId={(r) => r.id}
        pagination={{ page: 1, totalPages: 4, total: 80, noun: 'row', onPageChange }}
      />,
    );
    const nav = screen.getByRole('navigation', { name: 'Pagination' });
    expect(nav).toHaveTextContent('Page 1 of 4 · 80 rows');
    expect(screen.getByRole('table').contains(nav)).toBe(false);
    await user.click(within(nav).getByRole('button', { name: 'Next page' }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it('disables the pager while loading unless told otherwise', () => {
    const { rerender } = render(
      <DataTable columns={COLUMNS} rows={ROWS} getRowId={(r) => r.id} isLoading pagination={{ page: 2, totalPages: 4, onPageChange: () => {} }} />,
    );
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
    rerender(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        getRowId={(r) => r.id}
        isLoading
        pagination={{ page: 2, totalPages: 4, disabled: false, onPageChange: () => {} }}
      />,
    );
    expect(screen.getByRole('button', { name: 'Next page' })).toBeEnabled();
  });

  it('keeps the pager under an empty page so it can be left, but not under an error', () => {
    const { rerender } = render(
      <DataTable columns={COLUMNS} rows={[]} getRowId={(r) => r.id} empty={<p>Nothing on this page</p>} pagination={{ page: 3, totalPages: 3, onPageChange: () => {} }} />,
    );
    expect(screen.getByText('Nothing on this page')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeEnabled();
    rerender(
      <DataTable columns={COLUMNS} rows={[]} getRowId={(r) => r.id} error="Down" pagination={{ page: 3, totalPages: 3, onPageChange: () => {} }} />,
    );
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('renders no footer without the prop, or with a single page', () => {
    const { rerender } = render(<DataTable columns={COLUMNS} rows={ROWS} getRowId={(r) => r.id} />);
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    rerender(<DataTable columns={COLUMNS} rows={ROWS} getRowId={(r) => r.id} pagination={{ page: 1, totalPages: 1, onPageChange: () => {} }} />);
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });
});

describe('DataTable rowProps', () => {
  it('puts extra attributes on each row without replacing the kit ones', () => {
    render(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        getRowId={(r) => r.id}
        onRowClick={() => {}}
        rowProps={(r) => ({ 'data-testid': `row-${r.id}`, 'data-state': 'ok' })}
      />,
    );
    const row = screen.getByTestId('row-b');
    expect(row).toHaveTextContent('Bravo');
    expect(row).toHaveAttribute('data-state', 'ok');
    expect(row).toHaveAttribute('data-row-id', 'b');
    expect(row).toHaveAttribute('tabindex', '0');
  });
});

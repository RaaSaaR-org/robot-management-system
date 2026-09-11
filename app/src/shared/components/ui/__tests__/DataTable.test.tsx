/**
 * @file DataTable.test.tsx
 * @description Tests for DataTable: rendering, sorting, row click, row actions and states
 * @feature shared
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataTable, type DataTableColumn } from '../DataTable';

interface Robot {
  id: string;
  name: string;
  battery: number;
  status: string;
}

const ROBOTS: Robot[] = [
  { id: 'r1', name: 'Bravo', battery: 40, status: 'online' },
  { id: 'r2', name: 'Alpha', battery: 90, status: 'charging' },
  { id: 'r3', name: 'Charlie', battery: 5, status: 'offline' },
];

const COLUMNS: DataTableColumn<Robot>[] = [
  { key: 'name', header: 'Name', sortable: true },
  { key: 'battery', header: 'Battery', align: 'right', sortable: true, cell: (r) => `${r.battery}%` },
  { key: 'status', header: 'Status' },
];

function bodyRowNames(): string[] {
  const [, body] = screen.getAllByRole('rowgroup');
  return within(body)
    .getAllByRole('row')
    .map((row) => within(row).getAllByRole('cell')[0].textContent ?? '');
}

describe('DataTable', () => {
  it('renders a header and one row per record, with the caption', () => {
    render(<DataTable columns={COLUMNS} rows={ROBOTS} getRowId={(r) => r.id} caption="Robots" />);
    expect(screen.getByRole('table', { name: 'Robots' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Name/ })).toBeInTheDocument();
    expect(bodyRowNames()).toEqual(['Bravo', 'Alpha', 'Charlie']);
    expect(screen.getByText('90%')).toBeInTheDocument();
  });

  it('sorts ascending then descending and reports aria-sort', async () => {
    const user = userEvent.setup();
    render(<DataTable columns={COLUMNS} rows={ROBOTS} getRowId={(r) => r.id} />);
    const nameHeader = screen.getByRole('columnheader', { name: /Name/ });
    expect(nameHeader).toHaveAttribute('aria-sort', 'none');

    await user.click(within(nameHeader).getByRole('button'));
    expect(nameHeader).toHaveAttribute('aria-sort', 'ascending');
    expect(bodyRowNames()).toEqual(['Alpha', 'Bravo', 'Charlie']);

    await user.click(within(nameHeader).getByRole('button'));
    expect(nameHeader).toHaveAttribute('aria-sort', 'descending');
    expect(bodyRowNames()).toEqual(['Charlie', 'Bravo', 'Alpha']);
  });

  it('sorts numbers numerically', async () => {
    const user = userEvent.setup();
    render(<DataTable columns={COLUMNS} rows={ROBOTS} getRowId={(r) => r.id} />);
    await user.click(within(screen.getByRole('columnheader', { name: /Battery/ })).getByRole('button'));
    expect(bodyRowNames()).toEqual(['Charlie', 'Bravo', 'Alpha']);
  });

  it('does not mark unsortable columns with aria-sort', () => {
    render(<DataTable columns={COLUMNS} rows={ROBOTS} getRowId={(r) => r.id} />);
    expect(screen.getByRole('columnheader', { name: 'Status' })).not.toHaveAttribute('aria-sort');
  });

  it('calls onRowClick on click and on Enter', async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();
    render(<DataTable columns={COLUMNS} rows={ROBOTS} getRowId={(r) => r.id} onRowClick={onRowClick} />);
    const [, body] = screen.getAllByRole('rowgroup');
    const rows = within(body).getAllByRole('row');

    await user.click(within(rows[0]).getByText('Bravo'));
    expect(onRowClick).toHaveBeenLastCalledWith(ROBOTS[0]);

    rows[1].focus();
    await user.keyboard('{Enter}');
    expect(onRowClick).toHaveBeenLastCalledWith(ROBOTS[1]);
    expect(onRowClick).toHaveBeenCalledTimes(2);
  });

  it('opens row actions without triggering the row click', async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();
    const onEdit = vi.fn();
    render(
      <DataTable
        columns={COLUMNS}
        rows={ROBOTS}
        getRowId={(r) => r.id}
        onRowClick={onRowClick}
        rowActionsLabel={(r) => `Actions for ${r.name}`}
        rowActions={(r) => [{ label: 'Edit', onSelect: () => onEdit(r.id) }]}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Actions for Alpha' }));
    await user.click(screen.getByRole('menuitem', { name: 'Edit' }));
    expect(onEdit).toHaveBeenCalledWith('r2');
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('renders the empty slot when there are no rows', () => {
    render(<DataTable columns={COLUMNS} rows={[]} getRowId={(r) => r.id} empty={<p>No robots yet</p>} />);
    expect(screen.getByText('No robots yet')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows skeleton rows while loading', () => {
    render(<DataTable columns={COLUMNS} rows={[]} getRowId={(r) => r.id} isLoading skeletonRows={3} />);
    expect(screen.getByRole('table', { hidden: true })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    expect(screen.queryByText('No robots yet')).not.toBeInTheDocument();
  });

  it('keeps loaded rows visible during a refetch', () => {
    render(<DataTable columns={COLUMNS} rows={ROBOTS} getRowId={(r) => r.id} isLoading />);
    expect(bodyRowNames()).toHaveLength(3);
  });

  it('replaces the table with an ErrorState and retries', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(
      <DataTable
        columns={COLUMNS}
        rows={ROBOTS}
        getRowId={(r) => r.id}
        error="Server unreachable"
        errorTitle="Couldn't load robots"
        onRetry={onRetry}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load robots");
    expect(screen.getByText('Server unreachable')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});

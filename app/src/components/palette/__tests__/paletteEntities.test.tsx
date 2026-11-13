/**
 * @file paletteEntities.test.tsx
 * @description The palette finds datasets and robots by name (TASK-486).
 *              Typing "apple" used to find only pages whose letters happened to
 *              contain a-p-p-l-e; the two "Apple to Plate" datasets were not in
 *              it at all.
 * @feature layout
 */

import type { ReactElement } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { Bot, Database } from 'lucide-react';
import { NAV_GROUPS } from '@/components/layout/navigation';
import { CommandPalette, matchPalette, paletteDestinations } from '../CommandPalette';
import { entityRank, loadPaletteEntities, type PaletteEntity } from '../paletteEntities';

const listDatasets = vi.hoisted(() => vi.fn());
const listRobots = vi.hoisted(() => vi.fn());

vi.mock('@/features/training/api/trainingApi', () => ({ trainingApi: { listDatasets } }));
vi.mock('@/features/robots/api/robotsApi', () => ({ robotsApi: { listRobots } }));

vi.mock('@/shared/hooks', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useFeatures: () => ({ multiTenancyEnabled: false }) };
});
vi.mock('@/features/auth/store/authStore', () => ({
  selectUserRole: () => 'member',
  useAuthStore: (selector: (s: unknown) => unknown) => selector({}),
}));

const ENTITIES: PaletteEntity[] = [
  { kind: 'dataset', label: 'Apple to Plate — NVIDIA GR00T reference', detail: 'nvidia/GR00T-N1.7-AppleToPlate', path: '/datasets/ds-nv/episodes', icon: Database },
  { kind: 'dataset', label: 'Apple to Plate — our G1 recording', detail: 'ycchen0106/g1-apple-to-plate', path: '/datasets/ds-g1/episodes', icon: Database },
  { kind: 'dataset', label: 'Object in Box — SO-101 community set', detail: 'Thytu/so101-object-in-box_v0.4-fixed', path: '/datasets/ds-so/episodes', icon: Database },
  { kind: 'robot', label: 'Demo G1 with Dex3 hands', detail: 'demo-g1-dex3', path: '/robots/demo-g1-dex3', icon: Bot },
  { kind: 'robot', label: 'sim-robot-001', path: '/robots/sim-robot-001', icon: Bot },
];

const DESTINATIONS = paletteDestinations(NAV_GROUPS);

describe('matchPalette', () => {
  it('lists only pages while nothing is typed', () => {
    const results = matchPalette(DESTINATIONS, ENTITIES, '  ');
    expect(results.map((r) => r.label)).toEqual(DESTINATIONS.map((d) => d.label));
    expect(results.some((r) => r.entity)).toBe(false);
  });

  it('finds both apple datasets for "apple", ahead of pages matched by scattered letters', () => {
    const results = matchPalette(DESTINATIONS, ENTITIES, 'apple');
    expect(results.slice(0, 2).map((r) => r.label)).toEqual([
      'Apple to Plate — NVIDIA GR00T reference',
      'Apple to Plate — our G1 recording',
    ]);
    expect(results[0]).toMatchObject({ entity: 'dataset', path: '/datasets/ds-nv/episodes', trail: 'Dataset · nvidia/GR00T-N1.7-AppleToPlate' });
  });

  it('matches a word inside the name, the Hub repo id, and a robot id', () => {
    expect(matchPalette(DESTINATIONS, ENTITIES, 'plate').filter((r) => r.entity).map((r) => r.path)).toEqual([
      '/datasets/ds-nv/episodes',
      '/datasets/ds-g1/episodes',
    ]);
    expect(matchPalette(DESTINATIONS, ENTITIES, 'thytu').find((r) => r.entity)?.path).toBe('/datasets/ds-so/episodes');
    expect(matchPalette(DESTINATIONS, ENTITIES, 'dex3').find((r) => r.entity)).toMatchObject({ entity: 'robot', path: '/robots/demo-g1-dex3', trail: 'Robot · demo-g1-dex3' });
  });

  it('keeps a page whose name starts with the query in front of a dataset that does', () => {
    const entities: PaletteEntity[] = [{ kind: 'dataset', label: 'Datasets of mine', path: '/datasets/x/episodes', icon: Database }];
    const results = matchPalette(DESTINATIONS, entities, 'data');
    expect(results[0]).toMatchObject({ label: 'Datasets', path: '/datasets' });
    expect(results.map((r) => r.label)).toContain('Datasets of mine');
  });

  it('does not match a dataset by scattered letters', () => {
    expect(entityRank(ENTITIES[0], 'aple')).toBeNull();
    expect(entityRank(ENTITIES[0], 'apple')).toBe('prefix');
    expect(entityRank(ENTITIES[0], 'nvidia')).toBe('prefix');
    expect(entityRank(ENTITIES[0], 'toplate')).toBe('contains');
  });
});

describe('loadPaletteEntities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listDatasets.mockResolvedValue({ datasets: [{ id: 'ds 1', name: 'Apple to Plate', huggingFaceRepoId: 'nvidia/apple' }], pagination: {} });
    listRobots.mockResolvedValue({ robots: [{ id: 'sim-robot-001', name: 'sim-robot-001' }, { id: 'demo-so101', name: 'Demo SO-101' }], pagination: {} });
  });

  it('turns datasets and robots into destinations', async () => {
    expect(await loadPaletteEntities()).toEqual([
      { kind: 'dataset', label: 'Apple to Plate', detail: 'nvidia/apple', path: '/datasets/ds%201/episodes', icon: Database },
      { kind: 'robot', label: 'sim-robot-001', detail: undefined, path: '/robots/sim-robot-001', icon: Bot },
      { kind: 'robot', label: 'Demo SO-101', detail: 'demo-so101', path: '/robots/demo-so101', icon: Bot },
    ]);
  });

  it('keeps the robots when the datasets cannot be listed', async () => {
    listDatasets.mockRejectedValue(new Error('503'));
    expect((await loadPaletteEntities()).map((e) => e.kind)).toEqual(['robot', 'robot']);
  });
});

describe('the palette', () => {
  function LocationProbe(): ReactElement {
    const location = useLocation();
    return <span data-testid="location">{`${location.pathname}${location.search}`}</span>;
  }

  function renderPalette(loadEntities: () => Promise<PaletteEntity[]>) {
    return render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <CommandPalette open onClose={() => {}} loadEntities={loadEntities} />
        <LocationProbe />
      </MemoryRouter>,
    );
  }

  it('opens a dataset found by name on Enter', async () => {
    const load = vi.fn().mockResolvedValue(ENTITIES);
    renderPalette(load);
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'apple' } });
    const first = (await screen.findAllByRole('option'))[0];
    await waitFor(() => expect(screen.getAllByRole('option')[0]).toHaveAttribute('data-entity', 'dataset'));
    expect(first).toBeInTheDocument();
    expect(screen.getAllByRole('option')[0]).toHaveTextContent('Apple to Plate — NVIDIA GR00T reference · Dataset · nvidia/GR00T-N1.7-AppleToPlate');

    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    expect(screen.getByTestId('location')).toHaveTextContent('/datasets/ds-nv/episodes');
  });

  it('still finds pages when the lists cannot be loaded', async () => {
    const load = vi.fn().mockRejectedValue(new Error('offline'));
    renderPalette(load);
    await waitFor(() => expect(load).toHaveBeenCalled());

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'datasets' } });
    expect(screen.getAllByRole('option')[0]).toHaveTextContent('Datasets');
  });

  it('says so when neither a page nor a named thing matches', async () => {
    renderPalette(vi.fn().mockResolvedValue(ENTITIES));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'zzzzqq' } });
    expect(await screen.findByText('Nothing matches')).toBeInTheDocument();
  });
});

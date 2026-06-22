/**
 * @file zoneStore.test.ts
 * @description Tests for the zone management Zustand store
 * @feature fleet
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  useZoneStore,
  selectZones,
  selectZonesForCurrentFloor,
  selectZonesByFloor,
  selectZonesByType,
  selectSelectedZone,
  selectZoneById,
  selectCurrentFloor,
  selectIsLoading,
  selectError,
  selectEditorMode,
  selectIsEditing,
  selectEditingZone,
  selectDrawingBounds,
  selectShowFormModal,
  selectRestrictedZones,
  selectChargingZones,
} from '../zoneStore';
import { zoneApi } from '../../api/zoneApi';
import type { Zone, ZoneType, ZoneBounds } from '../../types/fleet.types';

vi.mock('../../api/zoneApi');

const mockedApi = vi.mocked(zoneApi);

const BOUNDS: ZoneBounds = { x: 0, y: 0, width: 10, height: 10 };

function makeZone(overrides: Partial<Zone> = {}): Zone {
  return {
    id: 'zone-1',
    name: 'Zone 1',
    floor: '1',
    bounds: BOUNDS,
    type: 'operational' as ZoneType,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const initialState = {
  zones: [],
  selectedZoneId: null,
  currentFloor: '1',
  isLoading: false,
  error: null,
  editorMode: 'view' as const,
  editingZone: null,
  drawingBounds: null,
  showFormModal: false,
};

describe('zoneStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useZoneStore.setState({ ...initialState });
  });

  // --------------------------------------------------------------------------
  // INITIAL STATE
  // --------------------------------------------------------------------------

  it('starts with the expected initial state', () => {
    const state = useZoneStore.getState();
    expect(state.zones).toEqual([]);
    expect(state.selectedZoneId).toBeNull();
    expect(state.currentFloor).toBe('1');
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
    expect(state.editorMode).toBe('view');
    expect(state.editingZone).toBeNull();
    expect(state.drawingBounds).toBeNull();
    expect(state.showFormModal).toBe(false);
  });

  // --------------------------------------------------------------------------
  // fetchZones
  // --------------------------------------------------------------------------

  it('fetchZones replaces zones with the paginated data', async () => {
    const zones = [makeZone({ id: 'a' }), makeZone({ id: 'b' })];
    mockedApi.getZones.mockResolvedValue({
      data: zones,
      pagination: { page: 1, pageSize: 20, total: 2, totalPages: 1 },
    });

    await useZoneStore.getState().fetchZones();

    const state = useZoneStore.getState();
    expect(state.zones).toEqual(zones);
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
  });

  it('fetchZones sets error and clears loading on failure', async () => {
    mockedApi.getZones.mockRejectedValue(new Error('fetch fail'));

    await useZoneStore.getState().fetchZones();

    const state = useZoneStore.getState();
    expect(state.error).toBe('fetch fail');
    expect(state.isLoading).toBe(false);
  });

  it('fetchZones uses fallback message for non-Error rejection', async () => {
    mockedApi.getZones.mockRejectedValue('weird');

    await useZoneStore.getState().fetchZones();

    expect(useZoneStore.getState().error).toBe('Failed to fetch zones');
  });

  // --------------------------------------------------------------------------
  // fetchZonesByFloor
  // --------------------------------------------------------------------------

  it('fetchZonesByFloor merges floor zones while keeping other floors', async () => {
    const floor2Zone = makeZone({ id: 'f2-existing', floor: '2' });
    useZoneStore.setState({ zones: [floor2Zone] });
    const floor1Zones = [makeZone({ id: 'f1-a', floor: '1' }), makeZone({ id: 'f1-b', floor: '1' })];
    mockedApi.getZonesByFloor.mockResolvedValue(floor1Zones);

    await useZoneStore.getState().fetchZonesByFloor('1');

    const state = useZoneStore.getState();
    expect(state.currentFloor).toBe('1');
    expect(state.zones.map((z) => z.id).sort()).toEqual(['f1-a', 'f1-b', 'f2-existing'].sort());
    expect(state.isLoading).toBe(false);
  });

  it('fetchZonesByFloor replaces stale zones of the same floor', async () => {
    useZoneStore.setState({ zones: [makeZone({ id: 'stale', floor: '1' })] });
    mockedApi.getZonesByFloor.mockResolvedValue([makeZone({ id: 'fresh', floor: '1' })]);

    await useZoneStore.getState().fetchZonesByFloor('1');

    expect(useZoneStore.getState().zones.map((z) => z.id)).toEqual(['fresh']);
  });

  it('fetchZonesByFloor sets error on failure but still updates currentFloor', async () => {
    mockedApi.getZonesByFloor.mockRejectedValue(new Error('floor fail'));

    await useZoneStore.getState().fetchZonesByFloor('3');

    const state = useZoneStore.getState();
    expect(state.currentFloor).toBe('3');
    expect(state.error).toBe('floor fail');
    expect(state.isLoading).toBe(false);
  });

  // --------------------------------------------------------------------------
  // SELECTION ACTIONS
  // --------------------------------------------------------------------------

  it('selectZone sets and clears the selected zone id', () => {
    useZoneStore.getState().selectZone('z9');
    expect(useZoneStore.getState().selectedZoneId).toBe('z9');

    useZoneStore.getState().selectZone(null);
    expect(useZoneStore.getState().selectedZoneId).toBeNull();
  });

  it('setCurrentFloor updates floor and triggers a floor fetch', async () => {
    mockedApi.getZonesByFloor.mockResolvedValue([makeZone({ id: 'x', floor: '5' })]);

    useZoneStore.getState().setCurrentFloor('5');

    expect(useZoneStore.getState().currentFloor).toBe('5');
    // setCurrentFloor delegates to fetchZonesByFloor
    expect(mockedApi.getZonesByFloor).toHaveBeenCalledWith('5');
  });

  // --------------------------------------------------------------------------
  // createZone
  // --------------------------------------------------------------------------

  it('createZone appends the zone and resets editor state', async () => {
    useZoneStore.setState({
      showFormModal: true,
      editingZone: makeZone(),
      drawingBounds: BOUNDS,
      editorMode: 'draw',
    });
    const created = makeZone({ id: 'new' });
    mockedApi.createZone.mockResolvedValue(created);

    const result = await useZoneStore
      .getState()
      .createZone({ name: 'New', floor: '1', type: 'operational', bounds: BOUNDS });

    expect(result).toEqual(created);
    const state = useZoneStore.getState();
    expect(state.zones).toContainEqual(created);
    expect(state.showFormModal).toBe(false);
    expect(state.editingZone).toBeNull();
    expect(state.drawingBounds).toBeNull();
    expect(state.editorMode).toBe('view');
    expect(state.isLoading).toBe(false);
  });

  it('createZone rethrows and records error on failure', async () => {
    mockedApi.createZone.mockRejectedValue(new Error('create fail'));

    await expect(
      useZoneStore
        .getState()
        .createZone({ name: 'x', floor: '1', type: 'operational', bounds: BOUNDS })
    ).rejects.toThrow('create fail');

    const state = useZoneStore.getState();
    expect(state.error).toBe('create fail');
    expect(state.isLoading).toBe(false);
    expect(state.zones).toEqual([]);
  });

  // --------------------------------------------------------------------------
  // updateZone
  // --------------------------------------------------------------------------

  it('updateZone replaces the matching zone in place', async () => {
    const original = makeZone({ id: 'u1', name: 'Old' });
    useZoneStore.setState({ zones: [original], showFormModal: true, editorMode: 'edit' });
    const updated = makeZone({ id: 'u1', name: 'New' });
    mockedApi.updateZone.mockResolvedValue(updated);

    const result = await useZoneStore.getState().updateZone('u1', { name: 'New' });

    expect(result).toEqual(updated);
    const state = useZoneStore.getState();
    expect(state.zones[0].name).toBe('New');
    expect(state.showFormModal).toBe(false);
    expect(state.editingZone).toBeNull();
    expect(state.editorMode).toBe('view');
  });

  it('updateZone leaves zones untouched when id is not found', async () => {
    useZoneStore.setState({ zones: [makeZone({ id: 'keep' })] });
    mockedApi.updateZone.mockResolvedValue(makeZone({ id: 'ghost', name: 'Ghost' }));

    await useZoneStore.getState().updateZone('ghost', { name: 'Ghost' });

    expect(useZoneStore.getState().zones.map((z) => z.id)).toEqual(['keep']);
  });

  it('updateZone rethrows and records error on failure', async () => {
    mockedApi.updateZone.mockRejectedValue(new Error('update fail'));

    await expect(useZoneStore.getState().updateZone('u1', { name: 'x' })).rejects.toThrow(
      'update fail'
    );
    expect(useZoneStore.getState().error).toBe('update fail');
    expect(useZoneStore.getState().isLoading).toBe(false);
  });

  // --------------------------------------------------------------------------
  // deleteZone
  // --------------------------------------------------------------------------

  it('deleteZone removes the zone and clears selection if it was selected', async () => {
    useZoneStore.setState({
      zones: [makeZone({ id: 'd1' }), makeZone({ id: 'd2' })],
      selectedZoneId: 'd1',
      editorMode: 'edit',
    });
    mockedApi.deleteZone.mockResolvedValue(undefined);

    const result = await useZoneStore.getState().deleteZone('d1');

    expect(result).toBe(true);
    const state = useZoneStore.getState();
    expect(state.zones.map((z) => z.id)).toEqual(['d2']);
    expect(state.selectedZoneId).toBeNull();
    expect(state.editorMode).toBe('view');
  });

  it('deleteZone keeps selection when a different zone is selected', async () => {
    useZoneStore.setState({
      zones: [makeZone({ id: 'd1' }), makeZone({ id: 'd2' })],
      selectedZoneId: 'd2',
    });
    mockedApi.deleteZone.mockResolvedValue(undefined);

    await useZoneStore.getState().deleteZone('d1');

    expect(useZoneStore.getState().selectedZoneId).toBe('d2');
  });

  it('deleteZone returns false and records error on failure', async () => {
    useZoneStore.setState({ zones: [makeZone({ id: 'd1' })] });
    mockedApi.deleteZone.mockRejectedValue(new Error('delete fail'));

    const result = await useZoneStore.getState().deleteZone('d1');

    expect(result).toBe(false);
    const state = useZoneStore.getState();
    expect(state.error).toBe('delete fail');
    expect(state.isLoading).toBe(false);
    // zone not removed on failure
    expect(state.zones.map((z) => z.id)).toEqual(['d1']);
  });

  // --------------------------------------------------------------------------
  // EDITOR ACTIONS
  // --------------------------------------------------------------------------

  it('setEditorMode to view clears drawingBounds and editingZone', () => {
    useZoneStore.setState({ drawingBounds: BOUNDS, editingZone: makeZone(), editorMode: 'draw' });

    useZoneStore.getState().setEditorMode('view');

    const state = useZoneStore.getState();
    expect(state.editorMode).toBe('view');
    expect(state.drawingBounds).toBeNull();
    expect(state.editingZone).toBeNull();
  });

  it('setEditorMode to non-view keeps drawing state', () => {
    useZoneStore.setState({ drawingBounds: BOUNDS });

    useZoneStore.getState().setEditorMode('draw');

    const state = useZoneStore.getState();
    expect(state.editorMode).toBe('draw');
    expect(state.drawingBounds).toEqual(BOUNDS);
  });

  it('startEditingZone opens the modal in edit mode with the zone', () => {
    const zone = makeZone({ id: 'edit-me' });
    useZoneStore.getState().startEditingZone(zone);

    const state = useZoneStore.getState();
    expect(state.editingZone).toEqual(zone);
    expect(state.showFormModal).toBe(true);
    expect(state.editorMode).toBe('edit');
  });

  it('startCreatingZone opens the modal in draw mode with no editing zone', () => {
    useZoneStore.setState({ editingZone: makeZone() });

    useZoneStore.getState().startCreatingZone();

    const state = useZoneStore.getState();
    expect(state.editingZone).toBeNull();
    expect(state.showFormModal).toBe(true);
    expect(state.editorMode).toBe('draw');
  });

  it('setDrawingBounds sets and clears the bounds', () => {
    useZoneStore.getState().setDrawingBounds(BOUNDS);
    expect(useZoneStore.getState().drawingBounds).toEqual(BOUNDS);

    useZoneStore.getState().setDrawingBounds(null);
    expect(useZoneStore.getState().drawingBounds).toBeNull();
  });

  it('closeFormModal resets the editor and modal state', () => {
    useZoneStore.setState({
      showFormModal: true,
      editingZone: makeZone(),
      drawingBounds: BOUNDS,
      editorMode: 'edit',
    });

    useZoneStore.getState().closeFormModal();

    const state = useZoneStore.getState();
    expect(state.showFormModal).toBe(false);
    expect(state.editingZone).toBeNull();
    expect(state.drawingBounds).toBeNull();
    expect(state.editorMode).toBe('view');
  });

  // --------------------------------------------------------------------------
  // WEBSOCKET EVENT HANDLERS
  // --------------------------------------------------------------------------

  it('handleZoneCreated adds a new zone but ignores duplicates', () => {
    const zone = makeZone({ id: 'ws1' });
    useZoneStore.getState().handleZoneCreated(zone);
    expect(useZoneStore.getState().zones.map((z) => z.id)).toEqual(['ws1']);

    // Duplicate is ignored
    useZoneStore.getState().handleZoneCreated(makeZone({ id: 'ws1', name: 'Dup' }));
    const state = useZoneStore.getState();
    expect(state.zones).toHaveLength(1);
    expect(state.zones[0].name).toBe('Zone 1');
  });

  it('handleZoneUpdated replaces an existing zone and ignores unknown ids', () => {
    useZoneStore.setState({ zones: [makeZone({ id: 'ws1', name: 'Old' })] });

    useZoneStore.getState().handleZoneUpdated(makeZone({ id: 'ws1', name: 'Updated' }));
    expect(useZoneStore.getState().zones[0].name).toBe('Updated');

    useZoneStore.getState().handleZoneUpdated(makeZone({ id: 'unknown', name: 'X' }));
    expect(useZoneStore.getState().zones.map((z) => z.id)).toEqual(['ws1']);
  });

  it('handleZoneDeleted removes the zone and clears selection if selected', () => {
    useZoneStore.setState({
      zones: [makeZone({ id: 'ws1' }), makeZone({ id: 'ws2' })],
      selectedZoneId: 'ws1',
    });

    useZoneStore.getState().handleZoneDeleted(makeZone({ id: 'ws1' }));

    const state = useZoneStore.getState();
    expect(state.zones.map((z) => z.id)).toEqual(['ws2']);
    expect(state.selectedZoneId).toBeNull();
  });

  it('handleZoneDeleted keeps selection of a different zone', () => {
    useZoneStore.setState({
      zones: [makeZone({ id: 'ws1' }), makeZone({ id: 'ws2' })],
      selectedZoneId: 'ws2',
    });

    useZoneStore.getState().handleZoneDeleted(makeZone({ id: 'ws1' }));

    expect(useZoneStore.getState().selectedZoneId).toBe('ws2');
  });

  // --------------------------------------------------------------------------
  // RESET
  // --------------------------------------------------------------------------

  it('reset restores the full initial state', () => {
    useZoneStore.setState({
      zones: [makeZone()],
      selectedZoneId: 'x',
      currentFloor: '7',
      isLoading: true,
      error: 'err',
      editorMode: 'draw',
      editingZone: makeZone(),
      drawingBounds: BOUNDS,
      showFormModal: true,
    });

    useZoneStore.getState().reset();

    expect(useZoneStore.getState()).toMatchObject(initialState);
  });

  // --------------------------------------------------------------------------
  // SELECTORS
  // --------------------------------------------------------------------------

  it('selectZones, selectCurrentFloor, selectIsLoading, selectError return slices', () => {
    const zones = [makeZone({ id: 'a' })];
    useZoneStore.setState({ zones, currentFloor: '2', isLoading: true, error: 'e' });
    const state = useZoneStore.getState();

    expect(selectZones(state)).toEqual(zones);
    expect(selectCurrentFloor(state)).toBe('2');
    expect(selectIsLoading(state)).toBe(true);
    expect(selectError(state)).toBe('e');
  });

  it('selectZonesForCurrentFloor and selectZonesByFloor filter by floor', () => {
    useZoneStore.setState({
      currentFloor: '1',
      zones: [
        makeZone({ id: 'f1', floor: '1' }),
        makeZone({ id: 'f2', floor: '2' }),
        makeZone({ id: 'f1b', floor: '1' }),
      ],
    });
    const state = useZoneStore.getState();

    expect(selectZonesForCurrentFloor(state).map((z) => z.id).sort()).toEqual(['f1', 'f1b']);
    expect(selectZonesByFloor('2')(state).map((z) => z.id)).toEqual(['f2']);
  });

  it('selectZonesByType, selectRestrictedZones, selectChargingZones filter by type', () => {
    useZoneStore.setState({
      zones: [
        makeZone({ id: 'op', type: 'operational' }),
        makeZone({ id: 'res', type: 'restricted' }),
        makeZone({ id: 'chg', type: 'charging' }),
      ],
    });
    const state = useZoneStore.getState();

    expect(selectZonesByType('operational')(state).map((z) => z.id)).toEqual(['op']);
    expect(selectRestrictedZones(state).map((z) => z.id)).toEqual(['res']);
    expect(selectChargingZones(state).map((z) => z.id)).toEqual(['chg']);
  });

  it('selectSelectedZone returns the zone or null', () => {
    const zone = makeZone({ id: 'sel' });
    useZoneStore.setState({ zones: [zone], selectedZoneId: 'sel' });
    expect(selectSelectedZone(useZoneStore.getState())).toEqual(zone);

    useZoneStore.setState({ selectedZoneId: null });
    expect(selectSelectedZone(useZoneStore.getState())).toBeNull();

    useZoneStore.setState({ selectedZoneId: 'missing' });
    expect(selectSelectedZone(useZoneStore.getState())).toBeNull();
  });

  it('selectZoneById finds the zone or returns undefined', () => {
    const zone = makeZone({ id: 'find' });
    useZoneStore.setState({ zones: [zone] });
    const state = useZoneStore.getState();

    expect(selectZoneById('find')(state)).toEqual(zone);
    expect(selectZoneById('nope')(state)).toBeUndefined();
  });

  it('selectEditorMode, selectIsEditing, selectEditingZone, selectDrawingBounds, selectShowFormModal', () => {
    const zone = makeZone();
    useZoneStore.setState({
      editorMode: 'edit',
      editingZone: zone,
      drawingBounds: BOUNDS,
      showFormModal: true,
    });
    const state = useZoneStore.getState();

    expect(selectEditorMode(state)).toBe('edit');
    expect(selectIsEditing(state)).toBe(true);
    expect(selectEditingZone(state)).toEqual(zone);
    expect(selectDrawingBounds(state)).toEqual(BOUNDS);
    expect(selectShowFormModal(state)).toBe(true);
  });

  it('selectIsEditing is false in view mode and true in draw mode', () => {
    useZoneStore.setState({ editorMode: 'view' });
    expect(selectIsEditing(useZoneStore.getState())).toBe(false);

    useZoneStore.setState({ editorMode: 'draw' });
    expect(selectIsEditing(useZoneStore.getState())).toBe(true);
  });
});

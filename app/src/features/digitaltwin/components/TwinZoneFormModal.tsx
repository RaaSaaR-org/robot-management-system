/**
 * @file TwinZoneFormModal.tsx
 * @description Modal form for creating/editing an L2 twin zone — name, type
 *   (keepout | workcell | charging | speed | room), color, and the floor/ceiling
 *   heights (minZ/maxZ). The polygon itself is captured by the authoring
 *   overlay; this modal just attaches metadata. Cloned from the fleet zone form.
 *
 *   TASK-200: a `room` (and a `keepout`, which is a place the robot must NOT
 *   stand in) also carries a `placeType` in `metadata` — the vocabulary the
 *   robot's place graph is expressed in. Places are HAND-AUTHORED here rather
 *   than derived from the twin-builder's DBSCAN clusters: a cluster is a blob of
 *   geometry with no name, and "AISLE-3" is a name a human uses out loud.
 * @feature digitaltwin
 */

import { useCallback, useEffect, useState } from 'react';
import { Modal, Button, Input } from '@/shared/components/ui';
import { useTwinZoneStore, TWIN_ZONE_COLORS } from '../store/twinZoneStore';
import { TWIN_PLACE_TYPES } from '../types/twin.types';
import type { TwinZoneDTO, TwinZoneType, TwinPlaceType, TwinPoint } from '../types/twin.types';

const TYPE_OPTIONS: { value: TwinZoneType; label: string }[] = [
  { value: 'keepout', label: 'Keep-out' },
  { value: 'workcell', label: 'Work cell' },
  { value: 'charging', label: 'Charging' },
  { value: 'speed', label: 'Speed limit' },
  { value: 'room', label: 'Room / place' },
];

/** Zone types that become entries in the robot's place graph. */
const PLACE_BEARING_TYPES: ReadonlySet<TwinZoneType> = new Set<TwinZoneType>(['room', 'keepout']);

const PLACE_TYPE_LABELS: Record<TwinPlaceType, string> = {
  aisle: 'Aisle',
  rack_face: 'Rack face',
  dock: 'Dock',
  staging: 'Staging',
  cell: 'Work cell',
  charging: 'Charging',
  corridor: 'Corridor',
  office: 'Office',
  unknown: 'Unclassified',
};

interface FormData {
  name: string;
  type: TwinZoneType;
  placeType: TwinPlaceType;
  color: string;
  minZ: string;
  maxZ: string;
}

const DEFAULT_FORM: FormData = {
  name: '',
  type: 'keepout',
  placeType: 'unknown',
  color: '',
  minZ: '0',
  maxZ: '2',
};

/** Read `metadata.placeType` back out of a saved zone, defaulting honestly. */
function readPlaceType(zone: TwinZoneDTO): TwinPlaceType {
  const raw = zone.metadata?.placeType;
  return typeof raw === 'string' && (TWIN_PLACE_TYPES as readonly string[]).includes(raw)
    ? (raw as TwinPlaceType)
    : 'unknown';
}

export interface TwinZoneFormModalProps {
  /** The twin (used only for context; the store knows its twinId). */
  twinId: string;
}

/**
 * Driven entirely by the twin zone store: opens when `showFormModal` is true,
 * in create mode (with `pendingPolygon`) or edit mode (with `editingZone`).
 */
export function TwinZoneFormModal(_props: TwinZoneFormModalProps) {
  const showFormModal = useTwinZoneStore((s) => s.showFormModal);
  const editingZone = useTwinZoneStore((s) => s.editingZone) as TwinZoneDTO | null;
  const pendingPolygon = useTwinZoneStore((s) => s.pendingPolygon) as TwinPoint[] | null;
  const isLoading = useTwinZoneStore((s) => s.isLoading);
  const error = useTwinZoneStore((s) => s.error);
  const createZone = useTwinZoneStore((s) => s.createZone);
  const updateZone = useTwinZoneStore((s) => s.updateZone);
  const closeFormModal = useTwinZoneStore((s) => s.closeFormModal);

  const [form, setForm] = useState<FormData>(DEFAULT_FORM);
  const [nameError, setNameError] = useState<string | null>(null);

  useEffect(() => {
    if (!showFormModal) return;
    if (editingZone) {
      setForm({
        name: editingZone.name,
        type: editingZone.type,
        placeType: readPlaceType(editingZone),
        color: editingZone.color ?? '',
        minZ: String(editingZone.minZ),
        maxZ: String(editingZone.maxZ),
      });
    } else {
      setForm(DEFAULT_FORM);
    }
    setNameError(null);
  }, [showFormModal, editingZone]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!form.name.trim()) {
        setNameError('Name is required');
        return;
      }
      const minZ = parseFloat(form.minZ);
      const maxZ = parseFloat(form.maxZ);
      // Merge, never replace: `metadata` also carries keys this form knows
      // nothing about (speedLimit, placeId, floor), and clobbering them here
      // would silently re-floor a place on every unrelated colour edit.
      const metadata: Record<string, unknown> = { ...(editingZone?.metadata ?? {}) };
      if (PLACE_BEARING_TYPES.has(form.type)) metadata.placeType = form.placeType;
      else delete metadata.placeType;

      const body = {
        name: form.name.trim(),
        type: form.type,
        color: form.color || undefined,
        minZ: Number.isFinite(minZ) ? minZ : 0,
        maxZ: Number.isFinite(maxZ) ? maxZ : 2,
        metadata,
      };

      if (editingZone) {
        await updateZone(editingZone.id, body);
      } else if (pendingPolygon && pendingPolygon.length >= 3) {
        await createZone({ ...body, points: pendingPolygon });
      }
    },
    [form, editingZone, pendingPolygon, createZone, updateZone],
  );

  const previewColor = form.color || TWIN_ZONE_COLORS[form.type] || '#2A5FFF';

  return (
    <Modal isOpen={showFormModal} onClose={closeFormModal} title={editingZone ? 'Edit zone' : 'New zone'}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-theme-secondary mb-1">Name</label>
          <Input
            value={form.name}
            onChange={(e) => {
              setForm((f) => ({ ...f, name: e.target.value }));
              if (nameError) setNameError(null);
            }}
            placeholder="Zone name"
            error={nameError ?? undefined}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-theme-secondary mb-1">Type</label>
          <select
            value={form.type}
            onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as TwinZoneType }))}
            className="w-full px-3 py-2 section-secondary border border-theme rounded-brand text-theme-primary focus:border-cobalt focus:outline-none focus:ring-1 focus:ring-cobalt"
          >
            {TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {PLACE_BEARING_TYPES.has(form.type) && (
          <div>
            <label className="block text-sm font-medium text-theme-secondary mb-1">Place type</label>
            <select
              value={form.placeType}
              onChange={(e) => setForm((f) => ({ ...f, placeType: e.target.value as TwinPlaceType }))}
              className="w-full px-3 py-2 section-secondary border border-theme rounded-brand text-theme-primary focus:border-cobalt focus:outline-none focus:ring-1 focus:ring-cobalt"
            >
              {TWIN_PLACE_TYPES.map((t) => (
                <option key={t} value={t}>{PLACE_TYPE_LABELS[t]}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-theme-tertiary">
              How the robot names this region out loud. Rooms and keep-outs are published to the
              robot as its place graph.
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-theme-secondary mb-1">Floor Z (m)</label>
            <Input
              type="number"
              step="0.1"
              value={form.minZ}
              onChange={(e) => setForm((f) => ({ ...f, minZ: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-theme-secondary mb-1">Ceiling Z (m)</label>
            <Input
              type="number"
              step="0.1"
              value={form.maxZ}
              onChange={(e) => setForm((f) => ({ ...f, maxZ: e.target.value }))}
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-theme-secondary mb-1">Color</label>
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={previewColor}
              onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
              className="h-9 w-12 rounded-brand border border-theme section-secondary"
              aria-label="Zone color"
            />
            <span className="text-xs text-theme-tertiary">Defaults to the type color when unset.</span>
          </div>
        </div>

        {!editingZone && pendingPolygon && (
          <p className="text-xs text-theme-tertiary">{pendingPolygon.length} vertices captured.</p>
        )}

        {error && (
          <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={closeFormModal} disabled={isLoading}>Cancel</Button>
          <Button type="submit" disabled={isLoading}>
            {isLoading ? 'Saving…' : editingZone ? 'Update zone' : 'Create zone'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

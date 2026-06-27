/**
 * @file TwinZoneFormModal.tsx
 * @description Modal form for creating/editing an L2 twin zone — name, type
 *   (keepout | workcell | charging | speed), color, and the floor/ceiling
 *   heights (minZ/maxZ). The polygon itself is captured by the authoring
 *   overlay; this modal just attaches metadata. Cloned from the fleet zone form.
 * @feature digitaltwin
 */

import { useCallback, useEffect, useState } from 'react';
import { Modal, Button, Input } from '@/shared/components/ui';
import { useTwinZoneStore, TWIN_ZONE_COLORS } from '../store/twinZoneStore';
import type { TwinZoneDTO, TwinZoneType, TwinPoint } from '../types/twin.types';

const TYPE_OPTIONS: { value: TwinZoneType; label: string }[] = [
  { value: 'keepout', label: 'Keep-out' },
  { value: 'workcell', label: 'Work cell' },
  { value: 'charging', label: 'Charging' },
  { value: 'speed', label: 'Speed limit' },
];

interface FormData {
  name: string;
  type: TwinZoneType;
  color: string;
  minZ: string;
  maxZ: string;
}

const DEFAULT_FORM: FormData = { name: '', type: 'keepout', color: '', minZ: '0', maxZ: '2' };

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
      const body = {
        name: form.name.trim(),
        type: form.type,
        color: form.color || undefined,
        minZ: Number.isFinite(minZ) ? minZ : 0,
        maxZ: Number.isFinite(maxZ) ? maxZ : 2,
      };

      if (editingZone) {
        await updateZone(editingZone.id, body);
      } else if (pendingPolygon && pendingPolygon.length >= 3) {
        await createZone({ ...body, points: pendingPolygon });
      }
    },
    [form, editingZone, pendingPolygon, createZone, updateZone],
  );

  const previewColor = form.color || TWIN_ZONE_COLORS[form.type] || '#FF6700';

  return (
    <Modal isOpen={showFormModal} onClose={closeFormModal} title={editingZone ? 'Edit zone' : 'New zone'}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">Name</label>
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
          <label className="block text-sm font-medium text-gray-300 mb-1">Type</label>
          <select
            value={form.type}
            onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as TwinZoneType }))}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-gray-200 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          >
            {TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Floor Z (m)</label>
            <Input
              type="number"
              step="0.1"
              value={form.minZ}
              onChange={(e) => setForm((f) => ({ ...f, minZ: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Ceiling Z (m)</label>
            <Input
              type="number"
              step="0.1"
              value={form.maxZ}
              onChange={(e) => setForm((f) => ({ ...f, maxZ: e.target.value }))}
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">Color</label>
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={previewColor}
              onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
              className="h-9 w-12 rounded border border-gray-600 bg-gray-800"
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

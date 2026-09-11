/**
 * @file ZonePanel.tsx
 * @description "Zones" side panel of the twin viewer: primary "New zone"
 *   enters draw mode (inset guide with Done / Undo / Cancel while drawing),
 *   the colour legend, and the zone list — each row selects its zone and has
 *   RowActions (Edit → TwinZoneFormModal, Delete → confirm → toast).
 * @feature digitaltwin
 */

import { memo } from 'react';
import { Pencil, Plus, Shapes, Trash2 } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { Button, EmptyState, Panel, RowActions, StatusTag, confirm, toast } from '@/shared/components/ui';
import { useTwinZoneStore, selectTwinDraftPoints, selectTwinZones, TWIN_ZONE_COLORS } from '../store/twinZoneStore';
import type { TwinZoneDTO } from '../types/twin.types';
import { ZoneLegend, ZONE_TYPE_LABELS } from './ZoneLegend';

export const ZonePanel = memo(function ZonePanel() {
  const zones = useTwinZoneStore(selectTwinZones);
  const mode = useTwinZoneStore((s) => s.mode);
  const setMode = useTwinZoneStore((s) => s.setMode);
  const selectedZoneId = useTwinZoneStore((s) => s.selectedZoneId);
  const selectZone = useTwinZoneStore((s) => s.selectZone);
  const deleteZone = useTwinZoneStore((s) => s.deleteZone);
  const startEditingZone = useTwinZoneStore((s) => s.startEditingZone);
  const draftPoints = useTwinZoneStore(selectTwinDraftPoints);
  const popDraftPoint = useTwinZoneStore((s) => s.popDraftPoint);
  const closeDraft = useTwinZoneStore((s) => s.closeDraft);
  const cancelDraft = useTwinZoneStore((s) => s.cancelDraft);
  const drawing = mode === 'draw';

  const askDelete = async (zone: TwinZoneDTO) => {
    const ok = await confirm({
      title: `Delete ${zone.name}?`,
      description: 'The zone is removed from the twin and from its next export.',
      tone: 'danger',
    });
    if (!ok) return;
    if (await deleteZone(zone.id)) toast.success('Zone deleted', { description: zone.name });
    else toast.error("Couldn't delete zone", { description: useTwinZoneStore.getState().error ?? zone.name });
  };

  const stopDrawing = () => {
    cancelDraft();
    setMode('view');
  };

  return (
    <Panel data-testid="zone-panel">
      <Panel.Header
        title="Zones"
        description={zones.length > 0 ? `${zones.length} zone${zones.length === 1 ? '' : 's'} on this floor` : 'Keep-outs, work cells and places'}
        actions={
          !drawing ? (
            <Button size="sm" leftIcon={<Plus className="h-4 w-4" strokeWidth={1.75} />} onClick={() => setMode('draw')}>
              New zone
            </Button>
          ) : undefined
        }
      />
      <Panel.Body className="flex flex-col gap-4">
        {drawing && (
          <div className="flex flex-col gap-2 rounded-control border border-line-subtle bg-inset p-3" role="status">
            <p className="text-[13px] text-ink-secondary">
              Click vertices in the editor · <span className="tabular-nums">{draftPoints.length}</span> placed
              {draftPoints.length >= 3 ? ', ready to close.' : ', at least 3 needed.'}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={draftPoints.length < 3} onClick={() => closeDraft()}>Done</Button>
              <Button size="sm" variant="secondary" disabled={draftPoints.length === 0} onClick={() => popDraftPoint()}>Undo</Button>
              <Button size="sm" variant="ghost" onClick={stopDrawing}>Cancel</Button>
            </div>
            <p className="text-xs text-ink-tertiary">Shortcuts: Enter closes · Backspace undoes · Esc cancels</p>
          </div>
        )}

        <ZoneLegend />

        {zones.length === 0 ? (
          <EmptyState size="sm" icon={<Shapes />} title="No zones yet" description="Draw a keep-out or a speed zone on the floor plan." />
        ) : (
          <ul className="flex flex-col gap-1">
            {zones.map((z) => (
              <li
                key={z.id}
                className={cn(
                  'flex items-center justify-between gap-2 rounded-control px-2 py-1.5 transition-colors',
                  z.id === selectedZoneId ? 'bg-primary/10' : 'hover:bg-inset',
                )}
                data-testid="twin-zone-row"
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary rounded-tag"
                  onClick={() => selectZone(z.id === selectedZoneId ? null : z.id)}
                  aria-pressed={z.id === selectedZoneId}
                >
                  <span
                    className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                    style={{ background: z.color || TWIN_ZONE_COLORS[z.type] || 'var(--color-primary)' }}
                    aria-hidden="true"
                  />
                  <span className="truncate text-sm text-ink-primary">{z.name}</span>
                  <StatusTag tone="neutral" size="sm">{ZONE_TYPE_LABELS[z.type] ?? z.type}</StatusTag>
                </button>
                <RowActions
                  label={`Actions for ${z.name}`}
                  size="sm"
                  items={[
                    { label: 'Edit', icon: <Pencil />, onSelect: () => startEditingZone(z) },
                    { label: 'Delete', icon: <Trash2 />, tone: 'danger', separatorBefore: true, onSelect: () => void askDelete(z) },
                  ]}
                />
              </li>
            ))}
          </ul>
        )}
      </Panel.Body>
    </Panel>
  );
});

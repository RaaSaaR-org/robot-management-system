/**
 * @file ZoneConfigPanel.tsx
 * @description The Zones panel beside the fleet map: the current floor's zones
 *   as a dense table with Edit and Delete row actions. Row click selects the
 *   zone on the map. Create and draw live in the page header.
 * @feature fleet
 * @dependencies @/shared/components/ui, @/features/fleet/hooks, @/features/fleet/utils
 */

import { MapPinned, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  Button,
  DataTable,
  EmptyState,
  Panel,
  StatusTag,
  confirm,
  toast,
  type DataTableColumn,
} from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import { useZones, useZoneManagement } from '../hooks';
import type { Zone } from '../types/fleet.types';
import { ZONE_TYPE_LABEL, ZONE_TYPE_TONE, zoneColor } from '../utils/mapColors';

export interface ZoneConfigPanelProps {
  /** Opens the zone form for a zone */
  onEditZone?: (zone: Zone) => void;
  /** Opens the zone form for a new zone */
  onCreateZone?: () => void;
  /** Additional class names */
  className?: string;
}

/**
 * Zones panel. Delete goes through the kit confirm() with the consequence
 * spelled out, then toasts the result.
 *
 * @example
 * ```tsx
 * <ZoneConfigPanel onEditZone={openEdit} onCreateZone={openCreate} />
 * ```
 */
export function ZoneConfigPanel({ onEditZone, onCreateZone, className }: ZoneConfigPanelProps) {
  const { zones, zonesForCurrentFloor, selectedZone, currentFloor, isLoading, error, selectZone, refresh } =
    useZones(false);
  const { deleteZone } = useZoneManagement();

  const askDelete = async (zone: Zone) => {
    const ok = await confirm({
      title: `Delete ${zone.name}?`,
      description: `Robots stop treating this area as a ${ZONE_TYPE_LABEL[zone.type].toLowerCase()} zone. This cannot be undone.`,
      tone: 'danger',
    });
    if (!ok) return;
    const deleted = await deleteZone(zone.id);
    if (deleted) toast.success('Zone deleted', { description: zone.name });
    else toast.error("Couldn't delete zone", { description: `${zone.name} is still on the map. Try again.` });
  };

  const columns: DataTableColumn<Zone>[] = [
    {
      key: 'name',
      header: 'Name',
      sortable: true,
      cell: (z) => (
        <span className="flex min-w-0 items-center gap-2">
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-sm"
            style={{ backgroundColor: zoneColor(z.type, z.color) }}
            aria-hidden="true"
          />
          <span className="truncate font-medium text-ink-primary">{z.name}</span>
        </span>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      sortable: true,
      hideBelow: 'sm',
      cell: (z) => <StatusTag tone={ZONE_TYPE_TONE[z.type]}>{ZONE_TYPE_LABEL[z.type]}</StatusTag>,
    },
  ];

  return (
    <Panel className={cn('flex flex-col', className)}>
      <Panel.Header
        title="Zones"
        description={`Floor ${currentFloor} · ${zonesForCurrentFloor.length} ${zonesForCurrentFloor.length === 1 ? 'zone' : 'zones'}`}
      />
      <DataTable
        caption={`Zones on floor ${currentFloor}`}
        dense
        columns={columns}
        rows={zonesForCurrentFloor}
        getRowId={(z) => z.id}
        defaultSort={{ key: 'name', direction: 'asc' }}
        onRowClick={(z) => selectZone(selectedZone?.id === z.id ? null : z.id)}
        rowClassName={(z) => (selectedZone?.id === z.id ? 'bg-primary/10' : undefined)}
        rowActions={(z) => [
          { label: 'Edit', icon: <Pencil />, onSelect: () => onEditZone?.(z) },
          { label: 'Delete', icon: <Trash2 />, tone: 'danger', separatorBefore: true, onSelect: () => void askDelete(z) },
        ]}
        rowActionsLabel={(z) => `Actions for ${z.name}`}
        isLoading={isLoading}
        // The store shares one error for fetch and mutations; a failed save
        // must not blank the list, so only a failed first load shows here.
        error={zones.length === 0 ? error : null}
        errorTitle="Couldn't load zones"
        onRetry={() => void refresh()}
        skeletonRows={4}
        empty={
          <EmptyState
            size="sm"
            icon={<MapPinned />}
            title="No zones on this floor"
            description="A zone tells robots how to treat an area."
            action={
              onCreateZone && (
                <Button size="sm" leftIcon={<Plus className="h-4 w-4" />} onClick={onCreateZone}>
                  New zone
                </Button>
              )
            }
          />
        }
      />
    </Panel>
  );
}

/**
 * @file ZoneConfigPanel.tsx
 * @description Panel for managing zones with list and controls
 * @feature fleet
 * @dependencies @/shared/components/ui, @/features/fleet/hooks, @/features/fleet/types
 */

import { useCallback } from 'react';
import { Button, Badge } from '@/shared/components/ui';
import { useZones, useZoneEditor, useZoneManagement } from '../hooks';
import type { Zone, ZoneType } from '../types/fleet.types';

// ============================================================================
// TYPES
// ============================================================================

export interface ZoneConfigPanelProps {
  /** Additional class names */
  className?: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const ZONE_TYPE_COLORS: Record<ZoneType, { bg: string; text: string }> = {
  operational: { bg: 'bg-primary-500/20', text: 'text-primary-400' },
  restricted: { bg: 'bg-red-500/20', text: 'text-red-400' },
  charging: { bg: 'bg-accent-500/20', text: 'text-accent-400' },
  maintenance: { bg: 'bg-orange-500/20', text: 'text-orange-400' },
};

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

interface ZoneListItemProps {
  zone: Zone;
  isSelected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function ZoneListItem({ zone, isSelected, onSelect, onEdit, onDelete }: ZoneListItemProps) {
  const colors = ZONE_TYPE_COLORS[zone.type];

  return (
    <div
      className={`
        p-3 rounded-lg border cursor-pointer transition-all
        ${isSelected
          ? 'border-primary-500 bg-primary-500/10'
          : 'border-gray-700 bg-gray-800/50 hover:border-gray-600'
        }
      `}
      onClick={onSelect}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-medium text-gray-200 truncate">{zone.name}</span>
          <Badge className={`${colors.bg} ${colors.text} text-xs`}>{zone.type}</Badge>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
            className="p-1.5 rounded hover:bg-gray-700 text-gray-400 hover:text-gray-200"
            aria-label="Edit zone"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
              />
            </svg>
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="p-1.5 rounded hover:bg-red-500/20 text-gray-400 hover:text-red-400"
            aria-label="Delete zone"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
          </button>
        </div>
      </div>
      <div className="text-xs text-gray-500 mt-1">
        Floor {zone.floor} &bull; {zone.bounds.width}x{zone.bounds.height}
      </div>
    </div>
  );
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Panel for managing zones with list and controls.
 *
 * @example
 * ```tsx
 * <ZoneConfigPanel className="w-80" />
 * ```
 */
export function ZoneConfigPanel({ className = '' }: ZoneConfigPanelProps) {
  const { zonesForCurrentFloor, selectedZone, currentFloor, isLoading, selectZone, refresh } =
    useZones();
  const { startEditingZone, startCreatingZone, editorMode, setEditorMode } = useZoneEditor();
  const { deleteZone } = useZoneManagement();

  const handleSelectZone = useCallback(
    (zone: Zone) => {
      selectZone(zone.id);
    },
    [selectZone]
  );

  const handleEditZone = useCallback(
    (zone: Zone) => {
      startEditingZone(zone);
    },
    [startEditingZone]
  );

  const handleDeleteZone = useCallback(
    async (zone: Zone) => {
      if (window.confirm(`Are you sure you want to delete "${zone.name}"?`)) {
        await deleteZone(zone.id);
      }
    },
    [deleteZone]
  );

  const handleCreateZone = useCallback(() => {
    startCreatingZone();
  }, [startCreatingZone]);

  const handleToggleDrawMode = useCallback(() => {
    if (editorMode === 'draw') {
      setEditorMode('view');
    } else {
      setEditorMode('draw');
    }
  }, [editorMode, setEditorMode]);

  return (
    <div
      className={`
        bg-gray-900/80 border border-gray-700 rounded-xl p-4
        backdrop-blur-sm
        ${className}
      `}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-200">Zones</h3>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Floor {currentFloor}</span>
          <button
            onClick={refresh}
            className="p-1.5 rounded hover:bg-gray-700 text-gray-400 hover:text-gray-200"
            aria-label="Refresh zones"
            disabled={isLoading}
          >
            <svg
              className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2 mb-4">
        <Button size="sm" onClick={handleCreateZone} className="flex-1">
          <svg className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Zone
        </Button>
        <Button
          size="sm"
          variant={editorMode === 'draw' ? 'primary' : 'secondary'}
          onClick={handleToggleDrawMode}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
            />
          </svg>
        </Button>
      </div>

      {/* Zone List */}
      <div className="space-y-2 max-h-[400px] overflow-y-auto">
        {zonesForCurrentFloor.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <svg
              className="w-12 h-12 mx-auto mb-2 opacity-50"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"
              />
            </svg>
            <p className="text-sm">No zones on this floor</p>
            <p className="text-xs mt-1">Click "Add Zone" to create one</p>
          </div>
        ) : (
          zonesForCurrentFloor.map((zone) => (
            <ZoneListItem
              key={zone.id}
              zone={zone}
              isSelected={selectedZone?.id === zone.id}
              onSelect={() => handleSelectZone(zone)}
              onEdit={() => handleEditZone(zone)}
              onDelete={() => handleDeleteZone(zone)}
            />
          ))
        )}
      </div>

      {/* Zone count */}
      {zonesForCurrentFloor.length > 0 && (
        <div className="text-xs text-gray-500 mt-3 pt-3 border-t border-gray-700">
          {zonesForCurrentFloor.length} zone{zonesForCurrentFloor.length !== 1 ? 's' : ''} on floor{' '}
          {currentFloor}
        </div>
      )}
    </div>
  );
}

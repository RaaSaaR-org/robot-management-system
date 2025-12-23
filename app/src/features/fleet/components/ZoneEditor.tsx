/**
 * @file ZoneEditor.tsx
 * @description SVG-based zone editor for drawing and resizing zones on the map
 * @feature fleet
 * @dependencies @/features/fleet/hooks, @/features/fleet/types
 */

import { useState, useCallback, useRef } from 'react';
import { useZoneEditor } from '../hooks';
import type { Zone, ZoneBounds } from '../types/fleet.types';

// ============================================================================
// TYPES
// ============================================================================

export interface ZoneEditorProps {
  /** Zones to display */
  zones: Zone[];
  /** Scale factor for coordinates */
  scale: number;
  /** Offset for positioning */
  offset: { x: number; y: number };
  /** Currently selected zone ID */
  selectedZoneId: string | null;
  /** Zone selection handler */
  onSelectZone: (id: string | null) => void;
  /** Zone double-click handler (for editing) */
  onEditZone: (zone: Zone) => void;
  /** New zone created handler */
  onZoneDrawn: (bounds: ZoneBounds) => void;
}

interface DragState {
  type: 'draw' | 'move' | 'resize';
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  zone?: Zone;
  handle?: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const HANDLE_SIZE = 8;
const MIN_ZONE_SIZE = 2; // Minimum zone size in map units

const ZONE_COLORS: Record<string, { stroke: string; fill: string }> = {
  operational: { stroke: '#2A5FFF', fill: 'rgba(42, 95, 255, 0.15)' },
  restricted: { stroke: '#ef4444', fill: 'rgba(239, 68, 68, 0.15)' },
  charging: { stroke: '#18E4C3', fill: 'rgba(24, 228, 195, 0.15)' },
  maintenance: { stroke: '#f97316', fill: 'rgba(249, 115, 22, 0.15)' },
};

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

interface ResizeHandleProps {
  x: number;
  y: number;
  cursor: string;
  onMouseDown: (e: React.MouseEvent) => void;
}

function ResizeHandle({ x, y, cursor, onMouseDown }: ResizeHandleProps) {
  return (
    <rect
      x={x - HANDLE_SIZE / 2}
      y={y - HANDLE_SIZE / 2}
      width={HANDLE_SIZE}
      height={HANDLE_SIZE}
      fill="#2A5FFF"
      stroke="#fff"
      strokeWidth={1}
      style={{ cursor }}
      onMouseDown={onMouseDown}
    />
  );
}

interface EditableZoneProps {
  zone: Zone;
  scale: number;
  offset: { x: number; y: number };
  isSelected: boolean;
  onSelect: () => void;
  onDoubleClick: () => void;
}

function EditableZone({
  zone,
  scale,
  offset,
  isSelected,
  onSelect,
  onDoubleClick,
}: EditableZoneProps) {
  const colors = ZONE_COLORS[zone.type] || ZONE_COLORS.operational;
  const x = zone.bounds.x * scale + offset.x;
  const y = zone.bounds.y * scale + offset.y;
  const width = zone.bounds.width * scale;
  const height = zone.bounds.height * scale;

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={isSelected ? colors.fill : 'rgba(100, 100, 100, 0.1)'}
        stroke={isSelected ? colors.stroke : '#666'}
        strokeWidth={isSelected ? 2 : 1}
        strokeDasharray={isSelected ? 'none' : '4,4'}
        rx={4}
        style={{ cursor: 'pointer' }}
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onDoubleClick();
        }}
      />
      {/* Zone label */}
      <text
        x={x + 6}
        y={y + 14}
        fontSize="10"
        fontFamily="monospace"
        fill={isSelected ? colors.stroke : '#888'}
        style={{ pointerEvents: 'none' }}
      >
        {zone.name}
      </text>
    </g>
  );
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * SVG-based zone editor for drawing and managing zones on the fleet map.
 *
 * @example
 * ```tsx
 * <svg>
 *   <ZoneEditor
 *     zones={zones}
 *     scale={10}
 *     offset={{ x: 40, y: 40 }}
 *     selectedZoneId={selectedId}
 *     onSelectZone={setSelectedId}
 *     onEditZone={(zone) => openEditModal(zone)}
 *     onZoneDrawn={(bounds) => openCreateModal(bounds)}
 *   />
 * </svg>
 * ```
 */
export function ZoneEditor({
  zones,
  scale,
  offset,
  selectedZoneId,
  onSelectZone,
  onEditZone,
  onZoneDrawn,
}: ZoneEditorProps) {
  const { editorMode, drawingBounds, setDrawingBounds } = useZoneEditor();
  const [dragState, setDragState] = useState<DragState | null>(null);
  const svgRef = useRef<SVGGElement>(null);

  // Convert screen coordinates to map coordinates
  const screenToMap = useCallback(
    (screenX: number, screenY: number): { x: number; y: number } => {
      const svg = svgRef.current?.ownerSVGElement;
      if (!svg) return { x: 0, y: 0 };

      const rect = svg.getBoundingClientRect();
      const svgX = screenX - rect.left;
      const svgY = screenY - rect.top;

      return {
        x: Math.round((svgX - offset.x) / scale),
        y: Math.round((svgY - offset.y) / scale),
      };
    },
    [scale, offset]
  );

  // Handle mouse down for drawing new zones
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (editorMode !== 'draw') return;

      const { x, y } = screenToMap(e.clientX, e.clientY);
      setDragState({
        type: 'draw',
        startX: x,
        startY: y,
        currentX: x,
        currentY: y,
      });
    },
    [editorMode, screenToMap]
  );

  // Handle mouse move for drawing
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!dragState) return;

      const { x, y } = screenToMap(e.clientX, e.clientY);

      if (dragState.type === 'draw') {
        setDragState((prev) => (prev ? { ...prev, currentX: x, currentY: y } : null));

        // Update drawing bounds
        const bounds: ZoneBounds = {
          x: Math.min(dragState.startX, x),
          y: Math.min(dragState.startY, y),
          width: Math.abs(x - dragState.startX),
          height: Math.abs(y - dragState.startY),
        };
        setDrawingBounds(bounds);
      }
    },
    [dragState, screenToMap, setDrawingBounds]
  );

  // Handle mouse up for completing draw
  const handleMouseUp = useCallback(() => {
    if (!dragState) return;

    if (dragState.type === 'draw' && drawingBounds) {
      // Check minimum size
      if (drawingBounds.width >= MIN_ZONE_SIZE && drawingBounds.height >= MIN_ZONE_SIZE) {
        onZoneDrawn(drawingBounds);
      }
    }

    setDragState(null);
    setDrawingBounds(null);
  }, [dragState, drawingBounds, onZoneDrawn, setDrawingBounds]);

  // Handle mouse leave - don't cancel during active drawing
  const handleMouseLeave = useCallback(() => {
    // Only cancel if not actively drawing (allow drawing to continue outside bounds)
    if (dragState && dragState.type !== 'draw') {
      setDragState(null);
      setDrawingBounds(null);
    }
  }, [dragState, setDrawingBounds]);

  // Handle click on empty space to deselect
  const handleBackgroundClick = useCallback(() => {
    onSelectZone(null);
  }, [onSelectZone]);

  // Get selected zone
  const selectedZone = zones.find((z) => z.id === selectedZoneId);

  // Render resize handles for selected zone
  const renderResizeHandles = () => {
    if (!selectedZone || editorMode !== 'edit') return null;

    const x = selectedZone.bounds.x * scale + offset.x;
    const y = selectedZone.bounds.y * scale + offset.y;
    const width = selectedZone.bounds.width * scale;
    const height = selectedZone.bounds.height * scale;

    const handles = [
      { id: 'nw', x: x, y: y, cursor: 'nwse-resize' },
      { id: 'ne', x: x + width, y: y, cursor: 'nesw-resize' },
      { id: 'sw', x: x, y: y + height, cursor: 'nesw-resize' },
      { id: 'se', x: x + width, y: y + height, cursor: 'nwse-resize' },
    ];

    return (
      <g>
        {handles.map((handle) => (
          <ResizeHandle
            key={handle.id}
            x={handle.x}
            y={handle.y}
            cursor={handle.cursor}
            onMouseDown={(e) => {
              e.stopPropagation();
              // Handle resize start - would need more implementation
            }}
          />
        ))}
      </g>
    );
  };

  return (
    <g
      ref={svgRef}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      onClick={handleBackgroundClick}
      style={{ cursor: editorMode === 'draw' ? 'crosshair' : 'default' }}
    >
      {/* Invisible background rect for capturing mouse events */}
      <rect
        x="0"
        y="0"
        width="9999"
        height="9999"
        fill="transparent"
      />

      {/* Editable zones */}
      {zones.map((zone) => (
        <EditableZone
          key={zone.id}
          zone={zone}
          scale={scale}
          offset={offset}
          isSelected={zone.id === selectedZoneId}
          onSelect={() => onSelectZone(zone.id)}
          onDoubleClick={() => onEditZone(zone)}
        />
      ))}

      {/* Resize handles for selected zone */}
      {renderResizeHandles()}

      {/* Drawing preview */}
      {editorMode === 'draw' && drawingBounds && (
        <rect
          x={drawingBounds.x * scale + offset.x}
          y={drawingBounds.y * scale + offset.y}
          width={drawingBounds.width * scale}
          height={drawingBounds.height * scale}
          fill="rgba(42, 95, 255, 0.2)"
          stroke="#2A5FFF"
          strokeWidth={2}
          strokeDasharray="4,4"
          rx={4}
          style={{ pointerEvents: 'none' }}
        />
      )}

      {/* Draw mode indicator */}
      {editorMode === 'draw' && !dragState && (
        <text
          x={offset.x}
          y={offset.y - 10}
          fontSize="11"
          fontFamily="monospace"
          fill="#2A5FFF"
          opacity={0.8}
        >
          Click and drag to draw a zone
        </text>
      )}
    </g>
  );
}

/**
 * @file RobotSelector.tsx
 * @description Multi-select component for targeting robots by type and zone
 * @feature deployment
 */

import { useState, useMemo } from 'react';
import { Card, Badge, Input } from '@/shared/components/ui';
import { cn } from '@/shared/utils';

export interface RobotSelectorProps {
  availableRobotTypes: string[];
  availableZones: string[];
  selectedRobotTypes: string[];
  selectedZones: string[];
  onRobotTypesChange: (types: string[]) => void;
  onZonesChange: (zones: string[]) => void;
  robotTypeCounts?: Record<string, number>;
  zoneCounts?: Record<string, number>;
  className?: string;
}

export function RobotSelector({
  availableRobotTypes,
  availableZones,
  selectedRobotTypes,
  selectedZones,
  onRobotTypesChange,
  onZonesChange,
  robotTypeCounts = {},
  zoneCounts = {},
  className,
}: RobotSelectorProps) {
  const [typeSearch, setTypeSearch] = useState('');
  const [zoneSearch, setZoneSearch] = useState('');

  // Filter robot types by search
  const filteredRobotTypes = useMemo(() => {
    if (!typeSearch) return availableRobotTypes;
    const query = typeSearch.toLowerCase();
    return availableRobotTypes.filter((type) => type.toLowerCase().includes(query));
  }, [availableRobotTypes, typeSearch]);

  // Filter zones by search
  const filteredZones = useMemo(() => {
    if (!zoneSearch) return availableZones;
    const query = zoneSearch.toLowerCase();
    return availableZones.filter((zone) => zone.toLowerCase().includes(query));
  }, [availableZones, zoneSearch]);

  const toggleRobotType = (type: string) => {
    if (selectedRobotTypes.includes(type)) {
      onRobotTypesChange(selectedRobotTypes.filter((t) => t !== type));
    } else {
      onRobotTypesChange([...selectedRobotTypes, type]);
    }
  };

  const toggleZone = (zone: string) => {
    if (selectedZones.includes(zone)) {
      onZonesChange(selectedZones.filter((z) => z !== zone));
    } else {
      onZonesChange([...selectedZones, zone]);
    }
  };

  const selectAllTypes = () => onRobotTypesChange([...availableRobotTypes]);
  const clearAllTypes = () => onRobotTypesChange([]);
  const selectAllZones = () => onZonesChange([...availableZones]);
  const clearAllZones = () => onZonesChange([]);

  const totalSelectedRobots = useMemo(() => {
    if (selectedRobotTypes.length === 0 && selectedZones.length === 0) {
      // All robots
      return Object.values(robotTypeCounts).reduce((sum, count) => sum + count, 0);
    }

    // This is a simplified estimate - actual count would need backend calculation
    let count = 0;
    selectedRobotTypes.forEach((type) => {
      count += robotTypeCounts[type] || 0;
    });
    return count || Object.values(robotTypeCounts).reduce((sum, c) => sum + c, 0);
  }, [selectedRobotTypes, selectedZones, robotTypeCounts]);

  return (
    <div className={cn('space-y-6', className)}>
      {/* Robot Types */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="block text-sm font-medium text-theme-primary">Robot Types</label>
          <div className="flex gap-2">
            <button
              onClick={selectAllTypes}
              className="text-xs text-cobalt-600 dark:text-cobalt-400 hover:underline"
            >
              Select all
            </button>
            <span className="text-theme-tertiary">|</span>
            <button
              onClick={clearAllTypes}
              className="text-xs text-cobalt-600 dark:text-cobalt-400 hover:underline"
            >
              Clear
            </button>
          </div>
        </div>

        <Input
          placeholder="Search robot types..."
          value={typeSearch}
          onChange={(e) => setTypeSearch(e.target.value)}
          className="w-full"
        />

        <div className="max-h-40 overflow-y-auto space-y-1 border border-gray-200 dark:border-gray-700 rounded-lg p-2">
          {filteredRobotTypes.length > 0 ? (
            filteredRobotTypes.map((type) => (
              <label
                key={type}
                className={cn(
                  'flex items-center justify-between p-2 rounded cursor-pointer transition-colors',
                  selectedRobotTypes.includes(type)
                    ? 'bg-cobalt-100 dark:bg-cobalt-900/30'
                    : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
                )}
              >
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={selectedRobotTypes.includes(type)}
                    onChange={() => toggleRobotType(type)}
                    className="rounded border-gray-300 text-cobalt-600 focus:ring-cobalt-500"
                  />
                  <span className="text-sm text-theme-primary">{type}</span>
                </div>
                {robotTypeCounts[type] !== undefined && (
                  <Badge variant="default" size="sm">
                    {robotTypeCounts[type]} robots
                  </Badge>
                )}
              </label>
            ))
          ) : (
            <p className="text-sm text-theme-secondary text-center py-2">
              {typeSearch ? 'No matching robot types' : 'No robot types available'}
            </p>
          )}
        </div>

        {selectedRobotTypes.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {selectedRobotTypes.map((type) => (
              <Badge
                key={type}
                variant="info"
                size="sm"
                className="cursor-pointer"
                onClick={() => toggleRobotType(type)}
              >
                {type}
                <svg className="w-3 h-3 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* Zones */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="block text-sm font-medium text-theme-primary">Zones</label>
          <div className="flex gap-2">
            <button
              onClick={selectAllZones}
              className="text-xs text-cobalt-600 dark:text-cobalt-400 hover:underline"
            >
              Select all
            </button>
            <span className="text-theme-tertiary">|</span>
            <button
              onClick={clearAllZones}
              className="text-xs text-cobalt-600 dark:text-cobalt-400 hover:underline"
            >
              Clear
            </button>
          </div>
        </div>

        <Input
          placeholder="Search zones..."
          value={zoneSearch}
          onChange={(e) => setZoneSearch(e.target.value)}
          className="w-full"
        />

        <div className="max-h-40 overflow-y-auto space-y-1 border border-gray-200 dark:border-gray-700 rounded-lg p-2">
          {filteredZones.length > 0 ? (
            filteredZones.map((zone) => (
              <label
                key={zone}
                className={cn(
                  'flex items-center justify-between p-2 rounded cursor-pointer transition-colors',
                  selectedZones.includes(zone)
                    ? 'bg-cobalt-100 dark:bg-cobalt-900/30'
                    : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
                )}
              >
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={selectedZones.includes(zone)}
                    onChange={() => toggleZone(zone)}
                    className="rounded border-gray-300 text-cobalt-600 focus:ring-cobalt-500"
                  />
                  <span className="text-sm text-theme-primary">{zone}</span>
                </div>
                {zoneCounts[zone] !== undefined && (
                  <Badge variant="default" size="sm">
                    {zoneCounts[zone]} robots
                  </Badge>
                )}
              </label>
            ))
          ) : (
            <p className="text-sm text-theme-secondary text-center py-2">
              {zoneSearch ? 'No matching zones' : 'No zones available'}
            </p>
          )}
        </div>

        {selectedZones.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {selectedZones.map((zone) => (
              <Badge
                key={zone}
                variant="info"
                size="sm"
                className="cursor-pointer"
                onClick={() => toggleZone(zone)}
              >
                {zone}
                <svg className="w-3 h-3 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* Summary */}
      <Card className="bg-gray-50 dark:bg-gray-800/50 p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-theme-secondary">Estimated target robots</span>
          <span className="text-lg font-semibold text-theme-primary">
            {selectedRobotTypes.length === 0 && selectedZones.length === 0
              ? `All (${totalSelectedRobots})`
              : totalSelectedRobots}
          </span>
        </div>
        {selectedRobotTypes.length === 0 && selectedZones.length === 0 && (
          <p className="text-xs text-theme-tertiary mt-1">
            No filters applied - deployment will target all compatible robots
          </p>
        )}
      </Card>
    </div>
  );
}

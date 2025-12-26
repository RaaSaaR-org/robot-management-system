/**
 * @file seedZones.ts
 * @description Seeds default zones into the database if none exist
 */

import { zoneService, type CreateZoneInput, type ZoneType } from '../services/ZoneService.js';

/** Default zones matching the frontend MOCK_ZONES */
const DEFAULT_ZONES: CreateZoneInput[] = [
  {
    name: 'Warehouse A',
    floor: '1',
    type: 'operational',
    bounds: { x: 0, y: 0, width: 20, height: 15 },
    color: '#3B82F6', // blue
  },
  {
    name: 'Warehouse B',
    floor: '1',
    type: 'operational',
    bounds: { x: 20, y: 0, width: 25, height: 20 },
    color: '#22C55E', // green
  },
  {
    name: 'Warehouse C',
    floor: '1',
    type: 'operational',
    bounds: { x: 35, y: 15, width: 15, height: 15 },
    color: '#F59E0B', // amber
  },
  {
    name: 'Charging Station',
    floor: '1',
    type: 'charging',
    bounds: { x: 0, y: 15, width: 10, height: 10 },
    color: '#10B981', // emerald
    description: 'Robot charging bay',
  },
  {
    name: 'Loading Dock',
    floor: '1',
    type: 'operational',
    bounds: { x: 10, y: 20, width: 20, height: 10 },
    color: '#6366F1', // indigo
  },
  {
    name: 'Maintenance Bay',
    floor: '1',
    type: 'maintenance',
    bounds: { x: 0, y: 25, width: 10, height: 10 },
    color: '#EF4444', // red
    description: 'Robot maintenance and repair area',
  },
  {
    name: 'Office Area',
    floor: '2',
    type: 'restricted',
    bounds: { x: 25, y: 0, width: 20, height: 15 },
    color: '#DC2626', // red-600
    description: 'Human-only area - robots not permitted',
  },
  {
    name: 'Hallway B',
    floor: '2',
    type: 'operational',
    bounds: { x: 10, y: 25, width: 25, height: 10 },
    color: '#8B5CF6', // violet
  },
];

/**
 * Seed default zones into the database if none exist.
 * This is the single source of truth for zone data.
 */
export async function seedZones(): Promise<void> {
  try {
    // Check if zones already exist
    const existingZones = await zoneService.getAllZones();

    if (existingZones.length > 0) {
      console.log(`[ZoneSeeder] Skipping - ${existingZones.length} zones already exist`);
      return;
    }

    console.log('[ZoneSeeder] Seeding default zones...');

    // Create all default zones
    for (const zoneInput of DEFAULT_ZONES) {
      try {
        const zone = await zoneService.createZone(zoneInput);
        console.log(`[ZoneSeeder] Created zone: ${zone.name} (${zone.type})`);
      } catch (error) {
        console.error(`[ZoneSeeder] Failed to create zone ${zoneInput.name}:`, error);
      }
    }

    console.log(`[ZoneSeeder] Successfully seeded ${DEFAULT_ZONES.length} zones`);
  } catch (error) {
    console.error('[ZoneSeeder] Failed to seed zones:', error);
  }
}

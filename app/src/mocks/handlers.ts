/**
 * @file handlers.ts
 * @description MSW request handlers for API mocking in tests
 */

import { http, HttpResponse } from 'msw';

// Mock robot data
const mockRobots = [
  {
    id: 'robot-001',
    name: 'Atlas-01',
    model: 'Atlas v3',
    status: 'idle',
    batteryLevel: 85,
    location: { x: 10.5, y: 8.3, floor: '1' },
    lastSeen: new Date().toISOString(),
    capabilities: ['navigation', 'manipulation'],
  },
  {
    id: 'robot-002',
    name: 'Spot-02',
    model: 'Spot v2',
    status: 'busy',
    batteryLevel: 62,
    location: { x: 25.1, y: 14.7, floor: '1' },
    lastSeen: new Date().toISOString(),
    capabilities: ['navigation', 'inspection'],
  },
];

const mockAlerts = [
  {
    id: 'alert-001',
    severity: 'warning',
    title: 'Low Battery',
    message: 'Spot-02 battery is low (62%)',
    source: 'robot',
    sourceId: 'robot-002',
    timestamp: new Date().toISOString(),
    dismissed: false,
  },
];

export const handlers = [
  // Health check
  http.get('/api/health', () => {
    return HttpResponse.json({ status: 'ok', timestamp: new Date().toISOString() });
  }),

  // List robots
  http.get('/api/robots', () => {
    return HttpResponse.json({
      robots: mockRobots,
      pagination: {
        page: 1,
        pageSize: mockRobots.length,
        total: mockRobots.length,
        totalPages: 1,
      },
    });
  }),

  // Get single robot
  http.get('/api/robots/:id', ({ params }) => {
    const robot = mockRobots.find((r) => r.id === params.id);
    if (!robot) {
      return HttpResponse.json({ error: 'Robot not found' }, { status: 404 });
    }
    return HttpResponse.json(robot);
  }),

  // List alerts
  http.get('/api/alerts', () => {
    return HttpResponse.json({ alerts: mockAlerts });
  }),

  // List zones
  http.get('/api/zones', () => {
    return HttpResponse.json({
      zones: [
        { id: 'zone-1', name: 'Warehouse A', type: 'operational', coordinates: [] },
      ],
    });
  }),
];

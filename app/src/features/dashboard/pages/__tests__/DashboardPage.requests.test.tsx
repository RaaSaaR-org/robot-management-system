/**
 * @file DashboardPage.requests.test.tsx
 * @description One dashboard load sends each list request once (TASK-362).
 *   With an empty fleet the page used to swap its body for a skeleton on every
 *   robots refetch; the remounted map and panels fetched again — a request loop
 *   that a production rate limiter answered with 429 and a logout.
 * @feature dashboard
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '@/mocks/server';
import { useRobotsStore } from '@/features/robots/store';
import { useAlertsStore } from '@/features/alerts/store/alertsStore';
import { useTwinStore } from '@/features/digitaltwin/store/twinStore';
import { DashboardPage } from '../DashboardPage';

const BOUNDS = { minX: 0, minY: 0, minZ: 0, maxX: 10, maxY: 10, maxZ: 3 };
const TWIN = { id: 'tw-1', name: 'Site', status: 'ready', worldOrigin: { x: 0, y: 0, z: 0 }, bounds: BOUNDS };

const counts = new Map<string, number>();
const countRequest = ({ request }: { request: Request }) => {
  const path = new URL(request.url).pathname;
  counts.set(path, (counts.get(path) ?? 0) + 1);
};

const settle = () => new Promise((r) => setTimeout(r, 300));

beforeEach(() => {
  counts.clear();
  useRobotsStore.getState().reset();
  useTwinStore.setState({ twins: [], isLoading: false, error: null });
  useAlertsStore.setState({ alerts: [] });
  server.use(
    http.get('/api/robots', () =>
      HttpResponse.json({ robots: [], pagination: { page: 1, pageSize: 0, total: 0, totalPages: 0 } })
    ),
    http.get('/api/alerts/active', () => HttpResponse.json({ alerts: [] })),
    http.get('/api/digital-twins', () => HttpResponse.json([TWIN])),
    http.get('/api/digital-twins/:id/zones', () => HttpResponse.json([]))
  );
  server.events.on('request:start', countRequest);
});

afterEach(() => {
  server.events.removeListener('request:start', countRequest);
});

describe('DashboardPage request budget', () => {
  it('sends each list request at most once with an empty fleet', async () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );

    await screen.findByText('Site map');
    await settle();

    expect(counts.get('/api/robots') ?? 0).toBe(1);
    expect(counts.get('/api/alerts/active') ?? 0).toBeLessThanOrEqual(1);
    expect(counts.get('/api/digital-twins') ?? 0).toBe(1);
    expect(counts.get('/api/digital-twins/tw-1/zones') ?? 0).toBe(1);
  });
});

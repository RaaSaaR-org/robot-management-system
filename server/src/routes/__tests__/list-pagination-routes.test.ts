/**
 * @file list-pagination-routes.test.ts
 * @description A list route answers garbage page/pageSize with 400 naming the
 *   parameter instead of handing NaN or a negative number to Prisma (TASK-386).
 * @feature core
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const { mockAlertService } = vi.hoisted(() => ({
  mockAlertService: { getAlerts: vi.fn(), getAlertHistory: vi.fn() },
}));

vi.mock('../../services/AlertService.js', () => ({ alertService: mockAlertService }));

import { alertRoutes } from '../alert.routes.js';

function app() {
  const a = express();
  a.use('/alerts', alertRoutes);
  return a;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAlertService.getAlerts.mockResolvedValue({ alerts: [], total: 0 });
  mockAlertService.getAlertHistory.mockResolvedValue({ alerts: [], total: 0 });
});

describe('GET /alerts pagination', () => {
  it.each([
    ['page=abc', 'page must be an integer'],
    ['page=0', 'page must be at least 1'],
    ['pageSize=-1', 'pageSize must be at least 1'],
  ])('refuses ?%s with 400', async (qs, message) => {
    const res = await request(app()).get(`/alerts?${qs}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(message);
    expect(mockAlertService.getAlerts).not.toHaveBeenCalled();
  });

  it('applies defaults when nothing is given', async () => {
    const res = await request(app()).get('/alerts');
    expect(res.status).toBe(200);
    expect(mockAlertService.getAlerts).toHaveBeenCalledWith(expect.anything(), {
      page: 1,
      pageSize: 50,
    });
  });
});

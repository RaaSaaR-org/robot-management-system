/**
 * @file marketplace-routes.test.ts
 * @description Publish, unpublish and delete of marketplace listings
 *   (TASK-272): seller-or-super-admin only, delete refused once a buyer holds
 *   a licence, every act recorded in the compliance log. Routes and service
 *   run for real against a mocked repository.
 * @feature marketplace
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const { mockRepo, mockAudit } = vi.hoisted(() => ({
  mockRepo: {
    findListingById: vi.fn(),
    updateListingStatus: vi.fn(),
    countPurchases: vi.fn(),
    deleteListing: vi.fn(),
    getSellerStats: vi.fn(),
  },
  mockAudit: vi.fn(),
}));

vi.mock('../repositories/MarketplaceRepository.js', () => ({ marketplaceRepository: mockRepo }));
vi.mock('../database/index.js', () => ({ prisma: {} }));
vi.mock('../services/buildAudit.js', () => ({ auditBuildAct: mockAudit }));

import { marketplaceRoutes } from '../routes/marketplace.routes.js';

const SELLER = 'seller-1';

function listingRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'lst-1',
    sellerId: SELLER,
    sellerName: 'Seller',
    type: 'skill',
    title: 'Apple to plate',
    shortDescription: 's',
    fullDescription: 'f',
    robotType: 'Unitree G1',
    baseModel: 'SmolVLA',
    tags: [],
    status: 'published',
    isFeatured: false,
    isTrending: false,
    downloadCount: 0,
    rating: 0,
    reviewCount: 0,
    taskCategory: null,
    successRate: null,
    adapterSizeMB: null,
    episodeCount: null,
    frameCount: null,
    datasetSizeGB: null,
    collectionMethod: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    licenses: [],
    reviews: [],
    ...overrides,
  };
}

function createApp(user: { id: string; role: string }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { user: unknown }).user = { ...user, name: 'U', email: 'u@x' };
    next();
  });
  app.use('/api/marketplace', marketplaceRoutes);
  return app;
}

const asSeller = () => createApp({ id: SELLER, role: 'member' });
const asStranger = () => createApp({ id: 'someone-else', role: 'owner' });
const asPlatformAdmin = () => createApp({ id: 'root', role: 'super-admin' });

beforeEach(() => {
  vi.clearAllMocks();
  mockRepo.getSellerStats.mockResolvedValue(new Map());
  mockRepo.countPurchases.mockResolvedValue(0);
});

describe('POST /api/marketplace/listings/:id/unpublish and /publish', () => {
  it('lets the seller unpublish their listing to a draft, and records it', async () => {
    mockRepo.findListingById
      .mockResolvedValueOnce(listingRecord())
      .mockResolvedValueOnce(listingRecord({ status: 'draft' }));

    const res = await request(asSeller()).post('/api/marketplace/listings/lst-1/unpublish');

    expect(res.status).toBe(200);
    expect(res.body.listing.id).toBe('lst-1');
    expect(mockRepo.updateListingStatus).toHaveBeenCalledWith('lst-1', 'draft');
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: 'marketplace_listing',
        action: 'unpublish',
        actorId: SELLER,
        metadata: expect.objectContaining({ previousStatus: 'published' }),
      })
    );
  });

  it('publishes a draft again', async () => {
    mockRepo.findListingById.mockResolvedValue(listingRecord({ status: 'draft' }));

    const res = await request(asSeller()).post('/api/marketplace/listings/lst-1/publish');

    expect(res.status).toBe(200);
    expect(mockRepo.updateListingStatus).toHaveBeenCalledWith('lst-1', 'published');
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'publish' }));
  });

  it("refuses someone else's listing with 403 — a tenant owner is just a seller here", async () => {
    mockRepo.findListingById.mockResolvedValue(listingRecord());

    const res = await request(asStranger()).post('/api/marketplace/listings/lst-1/unpublish');

    expect(res.status).toBe(403);
    expect(mockRepo.updateListingStatus).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('lets a super-admin unpublish any listing', async () => {
    mockRepo.findListingById.mockResolvedValue(listingRecord());

    const res = await request(asPlatformAdmin()).post('/api/marketplace/listings/lst-1/unpublish');

    expect(res.status).toBe(200);
  });

  it.each([
    ['suspended', 'publish'],
    ['suspended', 'unpublish'],
    ['pending_review', 'publish'],
  ])("refuses the seller a %s listing's %s with 409 — moderation is the platform's", async (status, act) => {
    mockRepo.findListingById.mockResolvedValue(listingRecord({ status }));

    const res = await request(asSeller()).post(`/api/marketplace/listings/lst-1/${act}`);

    expect(res.status).toBe(409);
    expect(mockRepo.updateListingStatus).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('lets a super-admin publish a suspended listing', async () => {
    mockRepo.findListingById.mockResolvedValue(listingRecord({ status: 'suspended' }));

    const res = await request(asPlatformAdmin()).post('/api/marketplace/listings/lst-1/publish');

    expect(res.status).toBe(200);
    expect(mockRepo.updateListingStatus).toHaveBeenCalledWith('lst-1', 'published');
  });

  it('answers 404 for an unknown listing', async () => {
    mockRepo.findListingById.mockResolvedValue(null);

    const res = await request(asSeller()).post('/api/marketplace/listings/ghost/unpublish');

    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/marketplace/listings/:id', () => {
  it('deletes a listing nobody bought and records the removed row', async () => {
    mockRepo.findListingById.mockResolvedValue(listingRecord());

    const res = await request(asSeller()).delete('/api/marketplace/listings/lst-1');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 'lst-1', outcome: 'deleted' });
    expect(mockRepo.deleteListing).toHaveBeenCalledWith('lst-1');
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'delete',
        metadata: expect.objectContaining({ title: 'Apple to plate', sellerId: SELLER }),
      })
    );
  });

  it('refuses with 409 once a buyer holds a licence', async () => {
    mockRepo.findListingById.mockResolvedValue(listingRecord());
    mockRepo.countPurchases.mockResolvedValue(2);

    const res = await request(asSeller()).delete('/api/marketplace/listings/lst-1');

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('unpublish it instead');
    expect(mockRepo.deleteListing).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it("refuses someone else's listing with 403", async () => {
    mockRepo.findListingById.mockResolvedValue(listingRecord());

    const res = await request(asStranger()).delete('/api/marketplace/listings/lst-1');

    expect(res.status).toBe(403);
    expect(mockRepo.deleteListing).not.toHaveBeenCalled();
  });
});

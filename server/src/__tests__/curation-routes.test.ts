/**
 * @file curation-routes.test.ts
 * @description Integration tests for data curation & augmentation routes
 * @feature datasets
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Use vi.hoisted so mock objects are available before vi.mock hoisting
const { mockDataCurationService, mockDataAugmentationService, mockDatasetCurationService, MockCurationError } =
  vi.hoisted(() => {
    class MockCurationError extends Error {
      readonly code: string;
      constructor(message: string, code: string) {
        super(message);
        this.name = 'CurationError';
        this.code = code;
      }
    }
    return {
      mockDataCurationService: {
        getTaxonomy: vi.fn(),
        categorizeTrajectory: vi.fn(),
      },
      mockDataAugmentationService: {
        paraphraseInstruction: vi.fn(),
        computeDiversityScore: vi.fn(),
      },
      mockDatasetCurationService: {
        deleteEpisodes: vi.fn(),
        trimEpisode: vi.fn(),
        suggest: vi.fn(),
      },
      MockCurationError,
    };
  });

vi.mock('../services/DataCurationService.js', () => ({
  dataCurationService: mockDataCurationService,
}));

vi.mock('../services/DataAugmentationService.js', () => ({
  dataAugmentationService: mockDataAugmentationService,
}));

vi.mock('../services/DatasetCurationService.js', () => ({
  datasetCurationService: mockDatasetCurationService,
  CurationError: MockCurationError,
}));

vi.mock('../middleware/auth.middleware.js', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-123', email: 'test@example.com', name: 'Test', role: 'admin' };
    next();
  },
  AuthenticatedRequest: {},
}));

import { curationRoutes } from '../routes/curation.routes.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/curation', authMiddleware as any, curationRoutes);
  return app;
}

const SAMPLE_TAXONOMY = [
  { id: 'grasp', name: 'Grasp Object', level: 'primitive', children: [] },
  { id: 'pick_place', name: 'Pick and Place', level: 'composed', children: ['grasp'] },
  { id: 'clean_table', name: 'Clean Table', level: 'long_horizon', children: ['pick_place'] },
];

describe('Curation Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // --------------------------------------------------------------------------
  // GET /api/curation/:id/distribution
  // --------------------------------------------------------------------------

  describe('GET /api/curation/:id/distribution', () => {
    it('returns a stub distribution analysis for the dataset', async () => {
      const response = await request(app).get('/api/curation/ds-1/distribution');

      expect(response.status).toBe(200);
      expect(response.body.datasetId).toBe('ds-1');
      expect(response.body.stubResult.totalTrajectories).toBe(0);
      expect(response.body.stubResult.byTaxonomyLevel).toEqual({
        primitive: 0,
        composed: 0,
        long_horizon: 0,
      });
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/curation/:id/balance
  // --------------------------------------------------------------------------

  describe('POST /api/curation/:id/balance', () => {
    it('queues a balanced subset for a valid config', async () => {
      const response = await request(app)
        .post('/api/curation/ds-1/balance')
        .send({ config: { method: 'uniform', groupBy: 'task' }, outputName: 'custom' });

      expect(response.status).toBe(200);
      expect(response.body.datasetId).toBe('ds-1');
      expect(response.body.message).toBe('Balanced subset creation queued');
      expect(response.body.config).toEqual({ method: 'uniform', groupBy: 'task' });
      expect(response.body.outputName).toBe('custom');
    });

    it('defaults outputName when not provided', async () => {
      const response = await request(app)
        .post('/api/curation/ds-1/balance')
        .send({ config: { method: 'sqrt', groupBy: 'environment' } });

      expect(response.status).toBe(200);
      expect(response.body.outputName).toBe('ds-1_balanced');
    });

    it('returns 400 when config is missing', async () => {
      const response = await request(app).post('/api/curation/ds-1/balance').send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('config is required');
    });

    it('returns 400 for an invalid method', async () => {
      const response = await request(app)
        .post('/api/curation/ds-1/balance')
        .send({ config: { method: 'bogus', groupBy: 'task' } });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid method');
    });

    it('returns 400 for an invalid groupBy', async () => {
      const response = await request(app)
        .post('/api/curation/ds-1/balance')
        .send({ config: { method: 'uniform', groupBy: 'bogus' } });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid groupBy');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/curation/:id/curate
  // --------------------------------------------------------------------------

  describe('POST /api/curation/:id/curate', () => {
    it('queues curation with provided config overrides', async () => {
      const response = await request(app)
        .post('/api/curation/ds-1/curate')
        .send({
          config: { minQualityScore: 70, identifyHarmful: false },
          createNewDataset: true,
          outputName: 'clean',
        });

      expect(response.status).toBe(200);
      expect(response.body.datasetId).toBe('ds-1');
      expect(response.body.message).toBe('Curation pipeline queued');
      expect(response.body.config.minQualityScore).toBe(70);
      expect(response.body.config.identifyHarmful).toBe(false);
      expect(response.body.config.deduplicationThreshold).toBe(0.95);
      expect(response.body.createNewDataset).toBe(true);
      expect(response.body.outputName).toBe('clean');
    });

    it('applies defaults when no body is sent', async () => {
      const response = await request(app).post('/api/curation/ds-1/curate').send({});

      expect(response.status).toBe(200);
      expect(response.body.config).toEqual({
        minQualityScore: 50,
        deduplicationThreshold: 0.95,
        identifyHarmful: true,
        hindsightRelabeling: false,
      });
      expect(response.body.createNewDataset).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/curation/:id/augment
  // --------------------------------------------------------------------------

  describe('POST /api/curation/:id/augment', () => {
    it('queues augmentation with config overrides', async () => {
      const response = await request(app)
        .post('/api/curation/ds-1/augment')
        .send({
          config: {
            action: { enabled: false, noiseScale: 0.2 },
            language: { enabled: true, paraphrasesPerInstruction: 5 },
          },
          createNewDataset: true,
          outputName: 'aug',
        });

      expect(response.status).toBe(200);
      expect(response.body.datasetId).toBe('ds-1');
      expect(response.body.message).toBe('Augmentation pipeline queued');
      expect(response.body.config.action.enabled).toBe(false);
      expect(response.body.config.action.noiseScale).toBe(0.2);
      expect(response.body.config.language.enabled).toBe(true);
      expect(response.body.config.language.paraphrasesPerInstruction).toBe(5);
      expect(response.body.createNewDataset).toBe(true);
      expect(response.body.outputName).toBe('aug');
    });

    it('applies defaults when no body is sent', async () => {
      const response = await request(app).post('/api/curation/ds-1/augment').send({});

      expect(response.status).toBe(200);
      expect(response.body.config.action.enabled).toBe(true);
      expect(response.body.config.action.noiseScale).toBe(0.05);
      expect(response.body.config.image.colorJitter).toBe(true);
      expect(response.body.config.language.enabled).toBe(false);
      expect(response.body.config.language.paraphrasesPerInstruction).toBe(3);
      expect(response.body.createNewDataset).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/curation/taxonomy
  // --------------------------------------------------------------------------

  describe('GET /api/curation/taxonomy', () => {
    it('returns the taxonomy grouped by level', async () => {
      mockDataCurationService.getTaxonomy.mockReturnValue(SAMPLE_TAXONOMY);

      const response = await request(app).get('/api/curation/taxonomy');

      expect(response.status).toBe(200);
      expect(response.body.totalTasks).toBe(3);
      expect(response.body.byLevel.primitive).toHaveLength(1);
      expect(response.body.byLevel.composed).toHaveLength(1);
      expect(response.body.byLevel.long_horizon).toHaveLength(1);
      expect(mockDataCurationService.getTaxonomy).toHaveBeenCalled();
    });

    it('returns 500 when the service throws', async () => {
      mockDataCurationService.getTaxonomy.mockImplementation(() => {
        throw new Error('boom');
      });

      const response = await request(app).get('/api/curation/taxonomy');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get taxonomy');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/curation/taxonomy/categorize
  // --------------------------------------------------------------------------

  describe('POST /api/curation/taxonomy/categorize', () => {
    it('categorizes an instruction', async () => {
      const categorization = {
        taxonomyId: 'pick_place',
        taxonomyName: 'Pick and Place',
        level: 'composed',
        confidence: 0.9,
      };
      mockDataCurationService.categorizeTrajectory.mockReturnValue(categorization);

      const response = await request(app)
        .post('/api/curation/taxonomy/categorize')
        .send({ languageInstruction: 'pick up the cube and place it' });

      expect(response.status).toBe(200);
      expect(response.body.instruction).toBe('pick up the cube and place it');
      expect(response.body.categorization).toEqual(categorization);
      expect(mockDataCurationService.categorizeTrajectory).toHaveBeenCalledWith(
        'pick up the cube and place it'
      );
    });

    it('returns 400 when languageInstruction is missing', async () => {
      const response = await request(app).post('/api/curation/taxonomy/categorize').send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('languageInstruction is required');
      expect(mockDataCurationService.categorizeTrajectory).not.toHaveBeenCalled();
    });

    it('returns 500 when the service throws', async () => {
      mockDataCurationService.categorizeTrajectory.mockImplementation(() => {
        throw new Error('boom');
      });

      const response = await request(app)
        .post('/api/curation/taxonomy/categorize')
        .send({ languageInstruction: 'do something' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to categorize trajectory');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/curation/:id/duplicates
  // --------------------------------------------------------------------------

  describe('GET /api/curation/:id/duplicates', () => {
    it('returns an empty stub with the default threshold', async () => {
      const response = await request(app).get('/api/curation/ds-1/duplicates');

      expect(response.status).toBe(200);
      expect(response.body.datasetId).toBe('ds-1');
      expect(response.body.threshold).toBe(0.95);
      expect(response.body.duplicateGroups).toEqual([]);
    });

    it('parses the threshold query param', async () => {
      const response = await request(app).get('/api/curation/ds-1/duplicates?threshold=0.8');

      expect(response.status).toBe(200);
      expect(response.body.threshold).toBe(0.8);
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/curation/:id/relabel-hindsight
  // --------------------------------------------------------------------------

  describe('POST /api/curation/:id/relabel-hindsight', () => {
    it('queues hindsight relabeling', async () => {
      const response = await request(app)
        .post('/api/curation/ds-1/relabel-hindsight')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.datasetId).toBe('ds-1');
      expect(response.body.message).toBe('Hindsight relabeling queued');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/curation/paraphrase
  // --------------------------------------------------------------------------

  describe('POST /api/curation/paraphrase', () => {
    it('generates paraphrases for an instruction', async () => {
      mockDataAugmentationService.paraphraseInstruction.mockReturnValue([
        'grab the cube',
        'take the cube',
      ]);

      const response = await request(app)
        .post('/api/curation/paraphrase')
        .send({ instruction: 'pick up the cube', count: 2 });

      expect(response.status).toBe(200);
      expect(response.body.original).toBe('pick up the cube');
      expect(response.body.paraphrases).toEqual(['grab the cube', 'take the cube']);
      expect(response.body.count).toBe(2);
      expect(mockDataAugmentationService.paraphraseInstruction).toHaveBeenCalledWith(
        'pick up the cube',
        2
      );
    });

    it('defaults count to 3 when not provided', async () => {
      mockDataAugmentationService.paraphraseInstruction.mockReturnValue(['a', 'b', 'c']);

      const response = await request(app)
        .post('/api/curation/paraphrase')
        .send({ instruction: 'pick up the cube' });

      expect(response.status).toBe(200);
      expect(mockDataAugmentationService.paraphraseInstruction).toHaveBeenCalledWith(
        'pick up the cube',
        3
      );
    });

    it('returns 400 when instruction is missing', async () => {
      const response = await request(app).post('/api/curation/paraphrase').send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('instruction is required');
      expect(mockDataAugmentationService.paraphraseInstruction).not.toHaveBeenCalled();
    });

    it('returns 500 when the service throws', async () => {
      mockDataAugmentationService.paraphraseInstruction.mockImplementation(() => {
        throw new Error('boom');
      });

      const response = await request(app)
        .post('/api/curation/paraphrase')
        .send({ instruction: 'pick up the cube' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to generate paraphrases');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/curation/diversity-score
  // --------------------------------------------------------------------------

  describe('POST /api/curation/diversity-score', () => {
    it('computes a high diversity score', async () => {
      mockDataAugmentationService.computeDiversityScore.mockReturnValue(0.9);

      const response = await request(app)
        .post('/api/curation/diversity-score')
        .send({ instructions: ['a', 'b', 'c'] });

      expect(response.status).toBe(200);
      expect(response.body.instructionCount).toBe(3);
      expect(response.body.diversityScore).toBe(0.9);
      expect(response.body.interpretation).toBe('High diversity');
      expect(mockDataAugmentationService.computeDiversityScore).toHaveBeenCalledWith([
        'a',
        'b',
        'c',
      ]);
    });

    it('labels moderate diversity', async () => {
      mockDataAugmentationService.computeDiversityScore.mockReturnValue(0.6);

      const response = await request(app)
        .post('/api/curation/diversity-score')
        .send({ instructions: ['a', 'b'] });

      expect(response.status).toBe(200);
      expect(response.body.interpretation).toBe('Moderate diversity');
    });

    it('labels low diversity', async () => {
      mockDataAugmentationService.computeDiversityScore.mockReturnValue(0.2);

      const response = await request(app)
        .post('/api/curation/diversity-score')
        .send({ instructions: ['a', 'b'] });

      expect(response.status).toBe(200);
      expect(response.body.interpretation).toContain('Low diversity');
    });

    it('returns 400 when instructions is missing or empty', async () => {
      const response = await request(app)
        .post('/api/curation/diversity-score')
        .send({ instructions: [] });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('instructions array is required');
      expect(mockDataAugmentationService.computeDiversityScore).not.toHaveBeenCalled();
    });

    it('returns 500 when the service throws', async () => {
      mockDataAugmentationService.computeDiversityScore.mockImplementation(() => {
        throw new Error('boom');
      });

      const response = await request(app)
        .post('/api/curation/diversity-score')
        .send({ instructions: ['a', 'b'] });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to compute diversity score');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/curation/:id/episodes/delete
  // --------------------------------------------------------------------------

  describe('POST /api/curation/:id/episodes/delete', () => {
    it('deletes episodes and returns the service result incl. newDatasetId', async () => {
      mockDatasetCurationService.deleteEpisodes.mockResolvedValue({
        datasetId: 'ds-1',
        ok: true,
        operation: 'delete episodes [0, 1]',
        output: '/tmp/ds-1__del-123',
        total_episodes: 2,
        total_frames: 42,
        stats_recompute_required: false,
        newDatasetId: 'ds-new',
        newDatasetName: 'ds one (curated)',
      });

      const response = await request(app)
        .post('/api/curation/ds-1/episodes/delete')
        .send({ episodes: [0, 1], datasetPath: '/tmp/ds-1' });

      expect(response.status).toBe(200);
      expect(response.body.datasetId).toBe('ds-1');
      expect(response.body.total_episodes).toBe(2);
      expect(response.body.newDatasetId).toBe('ds-new');
      expect(response.body.newDatasetName).toBe('ds one (curated)');
      expect(mockDatasetCurationService.deleteEpisodes).toHaveBeenCalledWith(
        'ds-1',
        [0, 1],
        '/tmp/ds-1'
      );
    });

    it('returns 400 when episodes is missing or empty', async () => {
      const response = await request(app)
        .post('/api/curation/ds-1/episodes/delete')
        .send({ episodes: [] });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('episodes (non-empty number[]) is required');
      expect(mockDatasetCurationService.deleteEpisodes).not.toHaveBeenCalled();
    });

    it('returns 500 with the service error message when the service rejects', async () => {
      mockDatasetCurationService.deleteEpisodes.mockRejectedValue(new Error('disk full'));

      const response = await request(app)
        .post('/api/curation/ds-1/episodes/delete')
        .send({ episodes: [0], datasetPath: '/tmp/ds-1' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('disk full');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/curation/:id/episodes/:index/trim
  // --------------------------------------------------------------------------

  describe('POST /api/curation/:id/episodes/:index/trim', () => {
    it('trims an episode and returns the service result', async () => {
      mockDatasetCurationService.trimEpisode.mockResolvedValue({
        datasetId: 'ds-1',
        ok: true,
        operation: 'trim episode 2 to [5, 20)',
        output: '/tmp/ds-1__trim-123',
        total_episodes: 4,
        total_frames: 70,
        stats_recompute_required: false,
        newDatasetId: 'ds-new-2',
      });

      const response = await request(app)
        .post('/api/curation/ds-1/episodes/2/trim')
        .send({ start: 5, end: 20, datasetPath: '/tmp/ds-1' });

      expect(response.status).toBe(200);
      expect(response.body.datasetId).toBe('ds-1');
      expect(response.body.total_frames).toBe(70);
      expect(response.body.newDatasetId).toBe('ds-new-2');
      expect(mockDatasetCurationService.trimEpisode).toHaveBeenCalledWith(
        'ds-1',
        2,
        5,
        20,
        '/tmp/ds-1'
      );
    });

    it('passes null end when end is omitted', async () => {
      mockDatasetCurationService.trimEpisode.mockResolvedValue({ datasetId: 'ds-1', ok: true });

      const response = await request(app)
        .post('/api/curation/ds-1/episodes/0/trim')
        .send({ start: 3, datasetPath: '/tmp/ds-1' });

      expect(response.status).toBe(200);
      expect(mockDatasetCurationService.trimEpisode).toHaveBeenCalledWith(
        'ds-1',
        0,
        3,
        null,
        '/tmp/ds-1'
      );
    });

    it('returns 400 for a non-integer/negative episode index', async () => {
      const response = await request(app)
        .post('/api/curation/ds-1/episodes/-1/trim')
        .send({ start: 0 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('episode index must be a non-negative integer');
      expect(mockDatasetCurationService.trimEpisode).not.toHaveBeenCalled();
    });

    it('returns 400 when start is missing or negative', async () => {
      const response = await request(app)
        .post('/api/curation/ds-1/episodes/0/trim')
        .send({ start: -5 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('start (>= 0) is required');
      expect(mockDatasetCurationService.trimEpisode).not.toHaveBeenCalled();
    });

    it('maps CurationError to 400 with its code (v3 trim unsupported)', async () => {
      mockDatasetCurationService.trimEpisode.mockRejectedValue(
        new MockCurationError('trim not supported for v3.0 datasets yet', 'V3_TRIM_UNSUPPORTED')
      );

      const response = await request(app)
        .post('/api/curation/ds-v3/episodes/0/trim')
        .send({ start: 0, end: 10 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('trim not supported for v3.0 datasets yet');
      expect(response.body.code).toBe('V3_TRIM_UNSUPPORTED');
    });

    it('returns 500 with the service error message when the service rejects', async () => {
      mockDatasetCurationService.trimEpisode.mockRejectedValue(new Error('bad frames'));

      const response = await request(app)
        .post('/api/curation/ds-1/episodes/0/trim')
        .send({ start: 0, datasetPath: '/tmp/ds-1' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('bad frames');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/curation/:id/suggest
  // --------------------------------------------------------------------------

  describe('POST /api/curation/:id/suggest', () => {
    it('returns the suggestion list from the service', async () => {
      mockDatasetCurationService.suggest.mockResolvedValue({
        datasetId: 'ds-1',
        ok: true,
        operation: 'suggest',
        suggestions: [
          { episode: 0, kind: 'trim', start: 10, end: 24, reason: 'idle padding', confidence: 0.85 },
          { episode: 1, kind: 'delete', reason: 'near-zero motion', confidence: 0.9 },
        ],
        vlmEnriched: false,
      });

      const response = await request(app)
        .post('/api/curation/ds-1/suggest')
        .send({ datasetPath: '/tmp/ds-1' });

      expect(response.status).toBe(200);
      expect(response.body.suggestions).toHaveLength(2);
      expect(response.body.suggestions[0].kind).toBe('trim');
      expect(mockDatasetCurationService.suggest).toHaveBeenCalledWith('ds-1', {
        episode: undefined,
        datasetPath: '/tmp/ds-1',
      });
    });

    it('passes the episode filter through', async () => {
      mockDatasetCurationService.suggest.mockResolvedValue({
        datasetId: 'ds-1',
        ok: true,
        operation: 'suggest',
        suggestions: [],
      });

      const response = await request(app)
        .post('/api/curation/ds-1/suggest')
        .send({ episode: 3 });

      expect(response.status).toBe(200);
      expect(mockDatasetCurationService.suggest).toHaveBeenCalledWith('ds-1', {
        episode: 3,
        datasetPath: undefined,
      });
    });

    it('returns 400 for a negative episode', async () => {
      const response = await request(app)
        .post('/api/curation/ds-1/suggest')
        .send({ episode: -2 });

      expect(response.status).toBe(400);
      expect(mockDatasetCurationService.suggest).not.toHaveBeenCalled();
    });

    it('maps CurationError codes to 400', async () => {
      mockDatasetCurationService.suggest.mockRejectedValue(
        new MockCurationError('suggestions not supported for v3.0 datasets yet', 'V3_SUGGEST_UNSUPPORTED')
      );

      const response = await request(app).post('/api/curation/ds-v3/suggest').send({});

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('V3_SUGGEST_UNSUPPORTED');
    });

    it('returns 500 for unexpected failures', async () => {
      mockDatasetCurationService.suggest.mockRejectedValue(new Error('boom'));

      const response = await request(app).post('/api/curation/ds-1/suggest').send({});

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('boom');
    });
  });
});

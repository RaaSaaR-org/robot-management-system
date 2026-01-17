/**
 * @file storage.routes.ts
 * @description REST API endpoints for storage operations
 * @feature storage
 */

import { Router, Request, Response } from 'express';
import {
  modelStorage,
  isRustFSInitialized,
  BUCKETS,
  SIZE_LIMITS,
  type BucketName,
} from '../storage/index.js';

export const storageRoutes = Router();

// ============================================================================
// MIDDLEWARE: Check if storage is available
// ============================================================================

const checkStorageAvailable = (req: Request, res: Response, next: () => void) => {
  if (!isRustFSInitialized()) {
    return res.status(503).json({
      error: 'Storage not available',
      message: 'RustFS storage is not initialized',
    });
  }
  next();
};

storageRoutes.use(checkStorageAvailable);

// ============================================================================
// POST /api/storage/presign - Get presigned upload URL
// ============================================================================

interface PresignRequest {
  bucket: BucketName;
  key: string;
  contentType: string;
  size: number;
}

storageRoutes.post('/presign', async (req: Request, res: Response) => {
  try {
    const { bucket, key, contentType, size } = req.body as PresignRequest;

    // Validate required fields
    if (!bucket || !key || !contentType || !size) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['bucket', 'key', 'contentType', 'size'],
      });
    }

    // Validate bucket
    if (!Object.values(BUCKETS).includes(bucket)) {
      return res.status(400).json({
        error: 'Invalid bucket',
        validBuckets: Object.values(BUCKETS),
      });
    }

    // Get presigned URL with size validation
    const result = await modelStorage.getPresignedUploadUrl(
      bucket,
      key,
      contentType,
      size
    );

    res.json({
      uploadUrl: result.url,
      expiresIn: result.expiresIn,
      bucket,
      key,
    });
  } catch (error) {
    console.error('[StorageRoutes] Error generating presigned URL:', error);
    const message = error instanceof Error ? error.message : 'Failed to generate presigned URL';
    res.status(400).json({ error: message });
  }
});

// ============================================================================
// POST /api/storage/datasets/:id/complete - Mark dataset upload complete
// ============================================================================

storageRoutes.post('/datasets/:id/complete', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { version, metadata } = req.body as {
      version: string;
      metadata?: Record<string, unknown>;
    };

    if (!version) {
      return res.status(400).json({ error: 'version is required' });
    }

    // Check if dataset exists
    const exists = await modelStorage.datasetExists(id, version);
    if (!exists) {
      return res.status(404).json({
        error: 'Dataset not found',
        message: `Dataset ${id}/${version} does not exist in storage`,
      });
    }

    // In a full implementation, we would trigger validation here
    // For now, just confirm the dataset exists

    res.json({
      success: true,
      datasetId: id,
      version,
      message: 'Dataset upload marked as complete',
    });
  } catch (error) {
    console.error('[StorageRoutes] Error completing dataset upload:', error);
    res.status(500).json({ error: 'Failed to complete dataset upload' });
  }
});

// ============================================================================
// GET /api/storage/datasets/:id/download - Get presigned download URL
// ============================================================================

storageRoutes.get('/datasets/:id/download', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { version } = req.query as { version?: string };

    if (!version) {
      return res.status(400).json({ error: 'version query parameter is required' });
    }

    // Check if dataset exists
    const exists = await modelStorage.datasetExists(id, version);
    if (!exists) {
      return res.status(404).json({
        error: 'Dataset not found',
        message: `Dataset ${id}/${version} does not exist`,
      });
    }

    const downloadUrl = await modelStorage.getDatasetDownloadUrl(id, version);

    res.json({
      downloadUrl,
      datasetId: id,
      version,
    });
  } catch (error) {
    console.error('[StorageRoutes] Error getting dataset download URL:', error);
    res.status(500).json({ error: 'Failed to get download URL' });
  }
});

// ============================================================================
// GET /api/storage/datasets - List datasets
// ============================================================================

storageRoutes.get('/datasets', async (req: Request, res: Response) => {
  try {
    const { prefix } = req.query as { prefix?: string };

    const datasets = await modelStorage.listDatasets(prefix);

    res.json({
      datasets,
      count: datasets.length,
    });
  } catch (error) {
    console.error('[StorageRoutes] Error listing datasets:', error);
    res.status(500).json({ error: 'Failed to list datasets' });
  }
});

// ============================================================================
// GET /api/storage/models/:id/download - Get model download URL
// ============================================================================

storageRoutes.get('/models/:id/download', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { version } = req.query as { version?: string };

    if (!version) {
      return res.status(400).json({ error: 'version query parameter is required' });
    }

    // Check if model exists
    const exists = await modelStorage.modelExists(id, version);
    if (!exists) {
      return res.status(404).json({
        error: 'Model not found',
        message: `Model ${id}/${version} does not exist`,
      });
    }

    const downloadUrl = await modelStorage.getModelDownloadUrl(id, version);

    res.json({
      downloadUrl,
      modelId: id,
      version,
    });
  } catch (error) {
    console.error('[StorageRoutes] Error getting model download URL:', error);
    res.status(500).json({ error: 'Failed to get download URL' });
  }
});

// ============================================================================
// GET /api/storage/models/:id/versions - List model versions
// ============================================================================

storageRoutes.get('/models/:id/versions', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const versions = await modelStorage.listModelVersions(id);

    res.json({
      modelId: id,
      versions,
      count: versions.length,
    });
  } catch (error) {
    console.error('[StorageRoutes] Error listing model versions:', error);
    res.status(500).json({ error: 'Failed to list model versions' });
  }
});

// ============================================================================
// GET /api/storage/checkpoints/:jobId - List checkpoints for a job
// ============================================================================

storageRoutes.get('/checkpoints/:jobId', async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;

    const checkpoints = await modelStorage.listCheckpoints(jobId);

    res.json({
      jobId,
      checkpoints,
      count: checkpoints.length,
    });
  } catch (error) {
    console.error('[StorageRoutes] Error listing checkpoints:', error);
    res.status(500).json({ error: 'Failed to list checkpoints' });
  }
});

// ============================================================================
// GET /api/storage/checkpoints/:jobId/:epoch/download - Get checkpoint download URL
// ============================================================================

storageRoutes.get('/checkpoints/:jobId/:epoch/download', async (req: Request, res: Response) => {
  try {
    const { jobId, epoch } = req.params;
    const epochNum = parseInt(epoch, 10);

    if (isNaN(epochNum)) {
      return res.status(400).json({ error: 'Invalid epoch number' });
    }

    const downloadUrl = await modelStorage.getCheckpointDownloadUrl(jobId, epochNum);

    res.json({
      downloadUrl,
      jobId,
      epoch: epochNum,
    });
  } catch (error) {
    console.error('[StorageRoutes] Error getting checkpoint download URL:', error);
    res.status(500).json({ error: 'Failed to get download URL' });
  }
});

// ============================================================================
// GET /api/storage/stats - Storage statistics
// ============================================================================

storageRoutes.get('/stats', async (req: Request, res: Response) => {
  try {
    const stats = await modelStorage.getAllStats();

    const totalObjects = stats.reduce((sum, s) => sum + s.objectCount, 0);
    const totalSize = stats.reduce((sum, s) => sum + s.totalSize, 0);

    res.json({
      buckets: stats,
      totals: {
        objectCount: totalObjects,
        totalSize,
        totalSizeFormatted: formatBytes(totalSize),
      },
      limits: SIZE_LIMITS,
    });
  } catch (error) {
    console.error('[StorageRoutes] Error getting storage stats:', error);
    res.status(500).json({ error: 'Failed to get storage statistics' });
  }
});

// ============================================================================
// DELETE /api/storage/temp/:key - Cancel incomplete upload
// ============================================================================

storageRoutes.delete('/temp/*', async (req: Request, res: Response) => {
  try {
    const key = req.params[0];

    if (!key) {
      return res.status(400).json({ error: 'Key is required' });
    }

    // Only allow deletion from temp/ prefix
    if (!key.startsWith('temp/')) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Only temp uploads can be deleted via this endpoint',
      });
    }

    const { getRustFSClient } = await import('../storage/index.js');
    const client = getRustFSClient();

    await client.delete(BUCKETS.MODEL_CHECKPOINTS, key);

    res.json({
      success: true,
      deletedKey: key,
    });
  } catch (error) {
    console.error('[StorageRoutes] Error deleting temp file:', error);
    res.status(500).json({ error: 'Failed to delete temp file' });
  }
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

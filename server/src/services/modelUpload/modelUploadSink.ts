/**
 * @file modelUploadSink.ts
 * @description Where a directly uploaded model checkpoint is stored (TASK-498):
 *              the dataset upload's two sinks, pointed at the models bucket and
 *              a model directory of their own.
 * @feature deployment
 *
 * A checkpoint lands under `uploads/<id>/` in the `production-models` bucket,
 * as the tree the client sent — `config.json`, the safetensors shards,
 * `processor/…` — so `artifactUri` names a prefix a loader can read as a
 * directory. Without an object store it goes to `MODEL_UPLOAD_DIR/<id>/`.
 */

import { dirname, join, resolve as resolvePath, sep } from 'path';
import { fileURLToPath } from 'url';
import { BUCKETS } from '../../storage/model-storage.js';
import {
  getRustFSClient,
  getRustFSStatus,
  isRustFSConfigured,
  isRustFSInitialized,
} from '../../storage/rustfs-client.js';
import { storageUnavailableMessage } from '../../storage/availability.js';
import { DatasetUploadError } from '../datasetUpload/uploadManifest.js';
import { LocalUploadSink, RustFsUploadSink, type UploadSink } from '../datasetUpload/UploadSink.js';

/** The bucket uploaded checkpoints are stored in. */
export const MODEL_UPLOAD_BUCKET = BUCKETS.PRODUCTION_MODELS;
/** Key prefix of every uploaded checkpoint; the upload's id follows. */
export const MODEL_UPLOAD_PREFIX = 'uploads/';

/** Where checkpoints go on a server without an object store. */
export function modelStorageRoot(): string {
  const configured = process.env.MODEL_UPLOAD_DIR;
  if (configured) return resolvePath(configured);
  return resolvePath(dirname(fileURLToPath(import.meta.url)), '../../../data/uploaded-models');
}

function storageUnavailable(): DatasetUploadError {
  const status = getRustFSStatus();
  return new DatasetUploadError(
    'STORAGE_UNAVAILABLE',
    storageUnavailableMessage(status.errorKind),
    503,
    { state: status.state, errorKind: status.errorKind },
  );
}

const LOCAL_LABEL = { what: 'model', variable: 'MODEL_UPLOAD_DIR' } as const;

/**
 * The sink a NEW model upload writes to — the dataset upload's rule: RustFS
 * when it is up, a 503 while it is configured but down, and local disk only
 * for a server with no object store at all.
 */
export function createModelUploadSink(uploadId: string): UploadSink {
  if (isRustFSInitialized()) {
    return new RustFsUploadSink(`${MODEL_UPLOAD_PREFIX}${uploadId}/`, getRustFSClient, MODEL_UPLOAD_BUCKET);
  }
  if (isRustFSConfigured()) throw storageUnavailable();
  return new LocalUploadSink(join(modelStorageRoot(), uploadId), LOCAL_LABEL);
}

/** The sink an EXISTING model upload was started with. */
export function openModelUploadSink(kind: 'local' | 'rustfs', storagePath: string): UploadSink {
  if (kind === 'local') {
    const root = resolvePath(storagePath);
    // Only ever a directory this server made for an upload.
    if (!root.startsWith(modelStorageRoot() + sep)) {
      throw new DatasetUploadError('STORAGE_UNAVAILABLE', `Local model storage ${storagePath} is not available`, 503);
    }
    return new LocalUploadSink(root, LOCAL_LABEL);
  }
  if (!isRustFSInitialized()) throw storageUnavailable();
  if (!storagePath.startsWith(MODEL_UPLOAD_PREFIX)) {
    throw new Error(`Refusing to open ${storagePath}: not an uploaded-model prefix`);
  }
  return new RustFsUploadSink(storagePath, getRustFSClient, MODEL_UPLOAD_BUCKET);
}

/**
 * The scheme-tagged location a registered model carries: the prefix (or
 * directory) that holds the checkpoint tree, with its trailing slash.
 */
export function artifactUriOf(kind: 'local' | 'rustfs', storagePath: string): string {
  return kind === 'rustfs'
    ? `s3://${MODEL_UPLOAD_BUCKET}/${storagePath}`
    : `file://${storagePath}`;
}

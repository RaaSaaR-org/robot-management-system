/**
 * @file index.ts
 * @description Barrel export for storage module
 * @feature storage
 */

export {
  RustFSClient,
  getRustFSClient,
  isRustFSInitialized,
  initializeRustFSClient,
} from './rustfs-client.js';
export type {
  RustFSConfig,
  UploadOptions,
  UploadProgress,
  ObjectMetadata,
  ListOptions,
  ListResult,
  ObjectInfo,
} from './rustfs-client.js';

export {
  ModelStorageClient,
  modelStorage,
  BUCKETS,
  SIZE_LIMITS,
  URL_EXPIRY,
} from './model-storage.js';
export type {
  BucketName,
  DatasetMetadata,
  DatasetInfo,
  CheckpointInfo,
  ModelMetadata,
  ModelVersionInfo,
  LogInfo,
  LogListOptions,
  CleanupResult,
  StorageStats,
} from './model-storage.js';

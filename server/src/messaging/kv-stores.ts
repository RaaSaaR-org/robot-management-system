/**
 * @file kv-stores.ts
 * @description NATS KV store definitions for job progress and model registry
 * @feature messaging
 */

import { JetStreamClient, KV, KvOptions, StorageType } from 'nats';

// ============================================================================
// KV STORE NAMES
// ============================================================================

export const KV_STORE_NAMES = {
  JOB_PROGRESS: 'JOB_PROGRESS',
  MODEL_REGISTRY: 'MODEL_REGISTRY',
  FLEET_CONFIG: 'FLEET_CONFIG',
} as const;

// ============================================================================
// KV STORE CREATION
// ============================================================================

/**
 * Create all required KV stores
 */
export async function createKVStores(js: JetStreamClient): Promise<void> {
  await createJobProgressKV(js);
  await createModelRegistryKV(js);
  await createFleetConfigKV(js);
  console.log('[KVStores] All KV stores created successfully');
}

/**
 * Create JOB_PROGRESS KV store for real-time job progress tracking
 */
async function createJobProgressKV(js: JetStreamClient): Promise<KV> {
  const name = KV_STORE_NAMES.JOB_PROGRESS;

  try {
    const kv = await js.views.kv(name, {
      description: 'Real-time training job progress tracking',
      history: 10, // Keep 10 revision history
      ttl: 60 * 60 * 1000, // 1 hour TTL (in milliseconds)
      storage: StorageType.File,
      replicas: 1,
    } as KvOptions);

    console.log(`[KVStores] Created KV store: ${name}`);
    return kv;
  } catch (error) {
    // KV store might already exist, try to get it
    console.log(`[KVStores] KV store ${name} may already exist, attempting to retrieve...`);
    return await js.views.kv(name);
  }
}

/**
 * Create MODEL_REGISTRY KV store for model metadata
 */
async function createModelRegistryKV(js: JetStreamClient): Promise<KV> {
  const name = KV_STORE_NAMES.MODEL_REGISTRY;

  try {
    const kv = await js.views.kv(name, {
      description: 'Model versions and deployment metadata',
      history: 50, // Keep 50 revision history for versioning
      storage: StorageType.File,
      replicas: 1,
    } as KvOptions);

    console.log(`[KVStores] Created KV store: ${name}`);
    return kv;
  } catch (error) {
    console.log(`[KVStores] KV store ${name} may already exist, attempting to retrieve...`);
    return await js.views.kv(name);
  }
}

/**
 * Create FLEET_CONFIG KV store for fleet-wide configuration
 */
async function createFleetConfigKV(js: JetStreamClient): Promise<KV> {
  const name = KV_STORE_NAMES.FLEET_CONFIG;

  try {
    const kv = await js.views.kv(name, {
      description: 'Fleet-wide configuration and settings',
      history: 20,
      storage: StorageType.File,
      replicas: 1,
    } as KvOptions);

    console.log(`[KVStores] Created KV store: ${name}`);
    return kv;
  } catch (error) {
    console.log(`[KVStores] KV store ${name} may already exist, attempting to retrieve...`);
    return await js.views.kv(name);
  }
}

// ============================================================================
// KV HELPER FUNCTIONS
// ============================================================================

/**
 * Get a value from KV store
 */
export async function kvGet<T>(kv: KV, key: string): Promise<T | null> {
  try {
    const entry = await kv.get(key);
    if (!entry || !entry.value) {
      return null;
    }
    const decoder = new TextDecoder();
    const value = decoder.decode(entry.value);
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

/**
 * Put a value to KV store
 */
export async function kvPut(kv: KV, key: string, value: unknown): Promise<number> {
  const encoder = new TextEncoder();
  const data = encoder.encode(JSON.stringify(value));
  return await kv.put(key, data);
}

/**
 * Delete a key from KV store
 */
export async function kvDelete(kv: KV, key: string): Promise<void> {
  await kv.delete(key);
}

/**
 * Watch a key for changes
 */
export async function kvWatch<T>(
  kv: KV,
  key: string,
  callback: (value: T | null, revision: number) => void
): Promise<() => void> {
  const watch = await kv.watch({ key });
  const decoder = new TextDecoder();

  const processUpdates = async () => {
    for await (const entry of watch) {
      if (entry.operation === 'DEL' || entry.operation === 'PURGE') {
        callback(null, entry.revision);
      } else if (entry.value) {
        try {
          const value = JSON.parse(decoder.decode(entry.value)) as T;
          callback(value, entry.revision);
        } catch (err) {
          console.error('[KVStores] Error parsing watch value:', err);
        }
      }
    }
  };

  processUpdates().catch((err) => {
    console.error('[KVStores] Watch error:', err);
  });

  return () => {
    watch.stop();
  };
}

/**
 * List all keys in KV store
 */
export async function kvKeys(kv: KV, filter?: string): Promise<string[]> {
  const keys: string[] = [];
  const iterator = await kv.keys(filter);
  for await (const key of iterator) {
    keys.push(key);
  }
  return keys;
}

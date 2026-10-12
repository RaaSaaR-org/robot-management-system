/**
 * @file availability.ts
 * @description Configured ⇒ required: one rule for every caller that would
 *              otherwise fall back to local disk while RustFS is down
 * @feature storage
 *
 * ADR-346 settled it for the HuggingFace importer (#368) and TASK-350 for every
 * other caller: a deployment that sets `RUSTFS_ENDPOINT` means to store in
 * RustFS, so while RustFS is down the answer is "not now", never the local
 * disk. In production that disk is a read-only image, and in any deployment a
 * file written there is one nothing will look for once RustFS is back. Local
 * disk is for a server with no object store configured at all.
 */

import { AppError } from '../utils/errors.js';
import { getRustFSStatus, isRustFSConfigured, isRustFSInitialized, type RustFSStatus } from './rustfs-client.js';

/** 503 `STORAGE_UNAVAILABLE`: RustFS is configured but not reachable right now. */
export class StorageUnavailableError extends AppError {
  readonly state: RustFSStatus['state'];
  readonly errorKind: RustFSStatus['errorKind'];

  constructor(status: Pick<RustFSStatus, 'state' | 'errorKind'> = getRustFSStatus()) {
    super(storageUnavailableMessage(status.errorKind), 503, 'STORAGE_UNAVAILABLE', {
      state: status.state,
      errorKind: status.errorKind,
    });
    this.state = status.state;
    this.errorKind = status.errorKind;
  }
}

/**
 * The sentence a person can act on. A `config` failure is not retried — the
 * environment will not change under a running process — so "try again
 * shortly" would never come true.
 */
export function storageUnavailableMessage(errorKind: RustFSStatus['errorKind']): string {
  const next = errorKind === 'config'
    ? 'its configuration is incomplete; set RUSTFS_ENDPOINT, RUSTFS_ACCESS_KEY and RUSTFS_SECRET_KEY and restart.'
    : 'the server is retrying — try again shortly.';
  return `Object storage (RustFS) is configured but unavailable (${errorKind ?? 'connecting'}); ${next}`;
}

/** True while RustFS is configured but has no live client — the "not now" window. */
export function isObjectStorageDown(): boolean {
  return isRustFSConfigured() && !isRustFSInitialized();
}

/**
 * Throw {@link StorageUnavailableError} while RustFS is configured but down.
 * A no-op when it is up, and when it is not configured at all — the caller's
 * own unconfigured behaviour (local disk, or its existing refusal) stands.
 */
export function refuseWhileObjectStorageDown(): void {
  if (isObjectStorageDown()) throw new StorageUnavailableError();
}

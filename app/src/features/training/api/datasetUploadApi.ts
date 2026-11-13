/**
 * @file datasetUploadApi.ts
 * @description The direct dataset upload API (`docs/dataset-upload.md`): start,
 *              status, one part, finish, cancel. Every refusal comes back as
 *              an `UploadRefusal` that keeps the server's sentence, its stable
 *              code and the context fields beside them (TASK-481).
 * @feature training
 */

import {
  apiClient,
  ensureFreshAccessToken,
  impersonationStorage,
  refreshAccessToken,
  tokenStorage,
} from '@/api/client';

// ============================================================================
// TYPES
// ============================================================================

export interface UploadStartInput {
  name: string;
  description?: string;
  robotTypeId?: string;
  /** The parsed `meta/info.json` */
  info: Record<string, unknown>;
  /** A part size smaller than the server's; the answer says which one applies */
  chunkSize?: number;
  files: { path: string; size: number }[];
}

export interface UploadFileEntry {
  id: number;
  path: string;
  size: number;
  partCount: number;
}

export interface UploadStartResponse {
  datasetId: string;
  status: string;
  state: UploadState;
  robotTypeId: string;
  storage: string;
  /** Bytes per part — this value, not the one that was asked for */
  chunkSize: number;
  totalBytes: number;
  files: UploadFileEntry[];
  ignored: { path: string; reason: string }[];
  idleTimeoutSeconds: number;
  expiresAt: string | null;
}

export type UploadState = 'uploading' | 'processing' | 'completed' | 'failed' | 'cancelling';

export interface UploadStatusFile extends UploadFileEntry {
  complete: boolean;
  receivedParts: number[];
}

export interface UploadStatusResponse {
  datasetId: string;
  state: UploadState;
  /** The dataset's status: uploading | validating | ready | failed */
  status: string;
  chunkSize: number;
  totalBytes: number;
  receivedBytes: number;
  totalFiles: number;
  completedFiles: number;
  readyToFinish: boolean;
  files: UploadStatusFile[];
  importError: { phase?: string; error?: string } | null;
}

export interface UploadFinishResponse {
  datasetId: string;
  state: UploadState;
  status: string;
}

/** What `409 UPLOAD_INCOMPLETE` lists (the first 50 files). */
export interface UploadMissingFile {
  fileId: number;
  path: string;
  missingParts: number[];
}

export interface PartAck {
  fileId: number;
  partNumber: number;
  size: number;
  /** SHA-256 the server computed over what it stored */
  sha256?: string;
  fileComplete?: boolean;
}

export interface PartRequest {
  datasetId: string;
  fileId: number;
  partNumber: number;
  body: ArrayBuffer | Blob;
  /** SHA-256 of `body`, 64 hex characters; the server refuses a mismatch */
  sha256?: string;
  /** Bytes of this part handed to the network so far */
  onProgress?: (loaded: number) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
}

// ============================================================================
// REFUSALS
// ============================================================================

/**
 * A request the upload API did not accept — or that never got an answer.
 * `status` is 0 when nothing came back (`NETWORK_ERROR`, `ABORTED`).
 */
export class UploadRefusal extends Error {
  readonly status: number;
  readonly code: string;
  /** The fields the server sent beside `error` and `code` (`expectedSize`, `state`, `missing`, …) */
  readonly context: Record<string, unknown>;
  /** Seconds, from the `Retry-After` header */
  readonly retryAfter: number | null;

  constructor(init: { status: number; code: string; message: string; context?: Record<string, unknown>; retryAfter?: number | null }) {
    super(init.message);
    this.name = 'UploadRefusal';
    this.status = init.status;
    this.code = init.code;
    this.context = init.context ?? {};
    this.retryAfter = init.retryAfter ?? null;
    Object.setPrototypeOf(this, UploadRefusal.prototype);
  }
}

function parseRetryAfter(value: unknown): number | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

/** Build the refusal from a status and whatever body came with it. */
export function refusalFrom(status: number, body: unknown, retryAfter?: unknown): UploadRefusal {
  const data = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const sentence = [data.error, data.message].find((v): v is string => typeof v === 'string' && v.trim() !== '');
  const { error: _error, message: _message, code, ...context } = data;
  return new UploadRefusal({
    status,
    code: typeof code === 'string' && code ? code : `HTTP_${status}`,
    message: sentence ?? (typeof body === 'string' && body.trim() ? body.trim().slice(0, 200) : `The server answered ${status}.`),
    context,
    retryAfter: parseRetryAfter(retryAfter),
  });
}

const networkRefusal = (message = 'The server could not be reached.'): UploadRefusal =>
  new UploadRefusal({ status: 0, code: 'NETWORK_ERROR', message });

// ============================================================================
// CONTROL CALLS
// ============================================================================

const CONTROL_TIMEOUT_MS = 90_000;

/**
 * One JSON call. Any status but 401 resolves here instead of going through the
 * shared client's error path, which keeps `message` and `code` but drops the
 * context fields a refusal carries; a 401 still takes that path, so the token
 * is refreshed and the request repeated as for every other call.
 */
async function control<T>(method: 'get' | 'post', path: string, body?: unknown): Promise<T> {
  let response;
  try {
    response = await apiClient.request<T>({
      method,
      url: path,
      data: body,
      timeout: CONTROL_TIMEOUT_MS,
      validateStatus: (status) => status !== 401,
    });
  } catch (error) {
    const e = error as { statusCode?: number; code?: string; message?: string };
    if (e?.statusCode) {
      throw new UploadRefusal({ status: e.statusCode, code: e.code ?? `HTTP_${e.statusCode}`, message: e.message ?? 'Request refused.' });
    }
    throw networkRefusal();
  }
  if (response.status >= 200 && response.status < 300) return response.data;
  throw refusalFrom(response.status, response.data, response.headers?.['retry-after']);
}

const base = (datasetId: string) => `/datasets/${encodeURIComponent(datasetId)}/upload`;

export const datasetUploadApi = {
  /** Declare the files. Creates the dataset; nothing is created when refused. */
  start: (input: UploadStartInput) => control<UploadStartResponse>('post', '/datasets/uploads', input),

  /** What the store holds — the resume point, and the verdict after finish. */
  status: (datasetId: string) => control<UploadStatusResponse>('get', base(datasetId)),

  /** Every part is sent. `409 UPLOAD_INCOMPLETE` lists what is not. */
  finish: (datasetId: string) => control<UploadFinishResponse>('post', `${base(datasetId)}/finish`),

  /** Stop, and remove everything stored and the dataset itself. */
  cancel: (datasetId: string) => control<{ datasetId: string; status: string }>('post', `${base(datasetId)}/cancel`),

  sendPart,
};

// ============================================================================
// ONE PART
// ============================================================================

const PART_TIMEOUT_MS = 10 * 60_000;

function partUrl(req: PartRequest): string {
  const root = (apiClient.defaults.baseURL ?? '/api').replace(/\/$/, '');
  return `${root}${base(req.datasetId)}/files/${req.fileId}/parts/${req.partNumber}`;
}

/**
 * PUT one part as a raw body. XMLHttpRequest rather than fetch or axios: it is
 * what reports upload progress in every browser, and it sends a buffer with a
 * `Content-Length` (the server answers a chunked body with 411).
 */
function putPart(req: PartRequest, token: string | null): Promise<PartAck> {
  return new Promise<PartAck>((resolve, reject) => {
    if (req.signal?.aborted) {
      reject(new UploadRefusal({ status: 0, code: 'ABORTED', message: 'The upload was stopped.' }));
      return;
    }
    const xhr = new XMLHttpRequest();
    const onAbort = () => xhr.abort();
    const done = () => req.signal?.removeEventListener('abort', onAbort);

    xhr.open('PUT', partUrl(req));
    xhr.timeout = req.timeoutMs ?? PART_TIMEOUT_MS;
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    if (req.sha256) xhr.setRequestHeader('X-Chunk-Sha256', req.sha256);
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    const impersonate = impersonationStorage.get();
    if (impersonate) xhr.setRequestHeader('X-Impersonate-Tenant', impersonate);

    xhr.upload.onprogress = (event) => req.onProgress?.(event.loaded);
    xhr.onload = () => {
      done();
      let body: unknown = xhr.responseText;
      try { body = JSON.parse(xhr.responseText); } catch { /* a proxy's HTML page */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as PartAck);
      else reject(refusalFrom(xhr.status, body, xhr.getResponseHeader('Retry-After')));
    };
    xhr.onerror = () => { done(); reject(networkRefusal('The connection dropped while sending a part.')); };
    xhr.ontimeout = () => { done(); reject(networkRefusal('A part did not get through in time.')); };
    xhr.onabort = () => { done(); reject(new UploadRefusal({ status: 0, code: 'ABORTED', message: 'The upload was stopped.' })); };
    req.signal?.addEventListener('abort', onAbort);
    xhr.send(req.body);
  });
}

/** Send one part; an expired access token is refreshed once and the part re-sent. */
async function sendPart(req: PartRequest): Promise<PartAck> {
  const token = await ensureFreshAccessToken();
  try {
    return await putPart(req, token);
  } catch (error) {
    if (!(error instanceof UploadRefusal) || error.status !== 401 || !tokenStorage.getRefreshToken()) throw error;
    let fresh: string;
    try { fresh = await refreshAccessToken(apiClient.defaults.baseURL); } catch { throw error; }
    return putPart(req, fresh);
  }
}

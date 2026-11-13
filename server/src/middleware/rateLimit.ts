/**
 * @file rateLimit.ts
 * @description The API's rate-limit budgets and the proxy trust they key on
 *   (TASK-482). Three budgets per client address and window, all in memory:
 *
 *   - **general** — everything under `/api` except dataset browsing. Sized for
 *     an interactive SPA, where one page view is a dozen requests.
 *   - **dataset browsing** — the reads the episode browser makes on every
 *     click: episode list, frames, statistics, the video (three or four Range
 *     requests per play) and its ticket. They have their own, larger budget so
 *     that watching episodes can never starve the rest of the API, and the
 *     rest of the API can never blank a video.
 *   - **writes** — every non-read request, counted a second time against a
 *     smaller budget. Credential endpoints keep their own much stricter
 *     limiter (`authRateLimit.ts`), MFA its own in `auth.routes.ts`.
 *
 *   Every 429 carries `Retry-After` (seconds until the window resets) — the
 *   app waits that long and retries by itself.
 * @feature security
 */

import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';
import type { Request, RequestHandler } from 'express';

export interface RateLimitConfig {
  /** `RATE_LIMIT_DISABLED=true`: no limiter counts anything. */
  disabled: boolean;
  /** `RATE_LIMIT_WINDOW_MS`: length of the counting window. */
  windowMs: number;
  /** `RATE_LIMIT_MAX`: general requests per window per client. */
  max: number;
  /** `RATE_LIMIT_MEDIA_MAX`: dataset-browsing requests per window per client. */
  mediaMax: number;
  /** `RATE_LIMIT_WRITE_MAX`: non-read requests per window per client. */
  writeMax: number;
}

/** Defaults in production. One window is a minute. */
export const RATE_LIMIT_DEFAULTS = {
  windowMs: 60_000,
  /** 20 requests a second, sustained — several people behind one address. */
  max: 1200,
  /** A video is 3–4 Range requests per camera; stepping through episodes adds up fast. */
  mediaMax: 3000,
  writeMax: 300,
} as const;

/** Outside production the budgets only catch a runaway loop. */
const DEV_MAX = 5000;

function positiveInt(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (Number.isInteger(value) && value > 0) return value;
  console.warn(`[rate-limit] ${name}="${raw}" is not a positive integer — using ${fallback}`);
  return fallback;
}

/** Read the budgets from the environment; anything unset or unusable is the default. */
export function readRateLimitConfig(env: NodeJS.ProcessEnv = process.env): RateLimitConfig {
  const production = env.NODE_ENV === 'production';
  return {
    disabled: env.RATE_LIMIT_DISABLED === 'true',
    windowMs: positiveInt(env.RATE_LIMIT_WINDOW_MS, RATE_LIMIT_DEFAULTS.windowMs, 'RATE_LIMIT_WINDOW_MS'),
    max: positiveInt(env.RATE_LIMIT_MAX, production ? RATE_LIMIT_DEFAULTS.max : DEV_MAX, 'RATE_LIMIT_MAX'),
    mediaMax: positiveInt(
      env.RATE_LIMIT_MEDIA_MAX,
      production ? RATE_LIMIT_DEFAULTS.mediaMax : DEV_MAX,
      'RATE_LIMIT_MEDIA_MAX'
    ),
    writeMax: positiveInt(
      env.RATE_LIMIT_WRITE_MAX,
      production ? RATE_LIMIT_DEFAULTS.writeMax : DEV_MAX,
      'RATE_LIMIT_WRITE_MAX'
    ),
  };
}

/** What Express' `trust proxy` setting accepts, minus the unsafe `true`. */
export type TrustProxySetting = false | number | string[];

/** One reverse proxy in front of the server: the long-standing default. */
export const DEFAULT_TRUST_PROXY: TrustProxySetting = 1;

/**
 * Parse `TRUST_PROXY` into Express' `trust proxy` setting.
 *
 * The limiters key on `req.ip`, and `req.ip` is read out of
 * `X-Forwarded-For` — a header any client can write. Express only believes the
 * entries that trusted proxies appended, so this setting decides whose address
 * a request is counted against:
 *
 * - a number — how many proxies sit between the client and this process. Each
 *   appends the address it saw; the client is that many entries from the
 *   right. `1` for one ingress, `2` for Cloudflare in front of one ingress.
 *   Too low and everyone behind the outermost proxy shares one bucket; too
 *   high and a client can choose its own address by sending the header.
 * - a comma-separated list of addresses, CIDR ranges or Express' names
 *   (`loopback`, `linklocal`, `uniquelocal`) — trust exactly those hops.
 * - `false` / `0` — no proxy: the socket address is the client.
 *
 * `true` ("believe the whole header") is refused: it lets any client pick a
 * fresh address per request and walk past every limit.
 */
export function parseTrustProxy(raw: string | undefined): TrustProxySetting {
  const value = raw?.trim();
  if (!value) return DEFAULT_TRUST_PROXY;
  const lower = value.toLowerCase();
  if (lower === 'false' || lower === '0') return false;
  if (lower === 'true') {
    console.warn(
      '[rate-limit] TRUST_PROXY=true would let any client spoof its address — using 1. ' +
        'Set the number of proxies in front of the server instead.'
    );
    return DEFAULT_TRUST_PROXY;
  }
  if (/^\d+$/.test(value)) return Number(value);
  const entries = value.split(',').map((entry) => entry.trim()).filter(Boolean);
  return entries.length > 0 ? entries : DEFAULT_TRUST_PROXY;
}

/** Methods that only read. */
const READ_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * `/api/datasets/:id/` followed by what the episode browser reads: the episode
 * list, one episode's frames and videos, statistics, joint groups.
 */
const DATASET_READ_PATH = /^\/api\/datasets\/[^/]+\/(?:episodes(?:\/.*)?|stats|modality)\/?$/;
/** The ticket a `<video>` plays with: a POST, but it changes nothing. */
const DATASET_TICKET_PATH = /^\/api\/datasets\/[^/]+\/video-ticket\/?$/;

/**
 * Whether a request belongs to the dataset-browsing budget.
 *
 * @param path The full path, mount included (`/api/datasets/…`), no query.
 */
export function isDatasetBrowseRequest(method: string, path: string): boolean {
  const verb = method.toUpperCase();
  if (verb === 'GET' || verb === 'HEAD') return DATASET_READ_PATH.test(path);
  return verb === 'POST' && DATASET_TICKET_PATH.test(path);
}

/** The path a request arrived on, wherever the limiter is mounted, without its query. */
function fullPath(req: Request): string {
  return (req.originalUrl || req.url).split('?')[0] ?? '';
}

export interface ApiLimiterOptions {
  /**
   * Requests no budget counts — for traffic that is bounded some other way,
   * like the parts of a dataset upload.
   *
   * @param path The full path, mount included (`/api/…`), no query.
   */
  exempt?: (method: string, path: string) => boolean;
}

export interface ApiLimiters {
  general: RateLimitRequestHandler;
  media: RateLimitRequestHandler;
  write: RateLimitRequestHandler;
}

/**
 * Build the three API limiters. Each has its own in-memory store, so a
 * request is counted by exactly the budgets that apply to it.
 */
export function createApiLimiters(config: RateLimitConfig, options: ApiLimiterOptions = {}): ApiLimiters {
  const { windowMs } = config;
  /** Nothing counts this request: limiting is off, or the request is exempt. */
  const uncounted = (req: Request) => config.disabled || options.exempt?.(req.method, fullPath(req)) === true;
  const common = {
    windowMs,
    // `RateLimit-*` response headers; also what makes the library send
    // `Retry-After` on a 429.
    standardHeaders: true,
    legacyHeaders: false,
  } as const;

  const general = rateLimit({
    ...common,
    limit: config.max,
    message: { error: 'Too many requests, please try again later.', code: 'RATE_LIMITED' },
    skip: (req) => uncounted(req) || isDatasetBrowseRequest(req.method, fullPath(req)),
  });

  const media = rateLimit({
    ...common,
    limit: config.mediaMax,
    message: { error: 'Too many dataset requests, please try again later.', code: 'RATE_LIMITED' },
    skip: (req) => uncounted(req) || !isDatasetBrowseRequest(req.method, fullPath(req)),
  });

  const write = rateLimit({
    ...common,
    // The general limiter already described the client's budget in the
    // `RateLimit-*` headers; this one only adds `Retry-After` when it refuses.
    standardHeaders: false,
    legacyHeaders: false,
    limit: config.writeMax,
    message: { error: 'Too many changes at once, please try again later.', code: 'RATE_LIMITED' },
    skip: (req) =>
      uncounted(req) || READ_METHODS.has(req.method.toUpperCase()) || isDatasetBrowseRequest(req.method, fullPath(req)),
    handler: (req, res, _next, options) => {
      const info = (req as Request & { rateLimit?: { resetTime?: Date } }).rateLimit;
      const resetMs = info?.resetTime ? info.resetTime.getTime() - Date.now() : windowMs;
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil(resetMs / 1000))));
      res.status(options.statusCode).json(options.message);
    },
  });

  return { general, media, write };
}

/** The limiters in the order to mount them on `/api`. */
export function apiRateLimit(config: RateLimitConfig, options: ApiLimiterOptions = {}): RequestHandler[] {
  const { general, media, write } = createApiLimiters(config, options);
  return [general, media, write];
}

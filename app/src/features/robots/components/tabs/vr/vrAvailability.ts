/**
 * @file vrAvailability.ts
 * @description Why WebXR is or is not usable on this origin, and which URLs to
 *              offer the operator so they can reach the page from inside the
 *              headset. Pure — no React, no three.js, no DOM globals; the
 *              caller passes in what it read from `navigator` and `location`.
 * @feature robots
 */

/**
 * - `ready` — `navigator.xr` exists on a secure origin. The caller still has to
 *   await `isSessionSupported('immersive-vr')`; this only says the API is
 *   reachable.
 * - `insecure-origin` — the page is plain http on a non-loopback host. WebXR is
 *   a secure-context API, so the browser does not expose `navigator.xr` at all
 *   and the page looks exactly like one on a browser with no WebXR.
 * - `unsupported` — secure origin, no WebXR. A desktop browser.
 */
export type XrAvailability = 'ready' | 'insecure-origin' | 'unsupported';

export interface XrAvailabilityInput {
  /** Whether `navigator.xr` is present. */
  hasXr: boolean;
  /** `window.isSecureContext`. */
  isSecureContext: boolean;
  /** `location.hostname`. */
  hostname: string;
}

/**
 * Hosts the platform treats as potentially trustworthy even over plain http.
 * Matches the W3C secure-contexts list the browsers implement: loopback by name
 * or literal, plus the `.localhost` reserved TLD.
 */
function isLoopbackHost(hostname: string): boolean {
  const h = (hostname ?? '').toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h.endsWith('.localhost') || h === '127.0.0.1' || h === '::1';
}

/**
 * Tell the two failures apart.
 *
 * The UI used to collapse "this browser has no WebXR" and "WebXR is present but
 * this origin is not secure" into one message that told the operator to open the
 * page in a headset — advice that is useless in the second case, because the
 * headset will fail exactly the same way. And the second case is the one an
 * operator on a LAN dev server actually hits: http://192.168.x.x:1420 is not a
 * secure context, so the Quest browser hides `navigator.xr` and the page has no
 * way to distinguish it from Firefox on a laptop.
 *
 * Insecurity is therefore checked FIRST and reported regardless of `hasXr`,
 * because on an insecure origin `hasXr` is false for a reason that has nothing
 * to do with the browser's capabilities.
 */
export function resolveXrAvailability(input: XrAvailabilityInput): XrAvailability {
  // `isSecureContext` is authoritative where it exists; the hostname check is
  // the fallback for embedded webviews and test environments that never set it.
  const secure = input.isSecureContext || isLoopbackHost(input.hostname);
  if (!secure) return 'insecure-origin';
  return input.hasXr ? 'ready' : 'unsupported';
}

/** The bits of `window.location` this module reads. */
export interface LocationLike {
  protocol: string;
  hostname: string;
  port: string;
  pathname: string;
  search: string;
  hash: string;
}

export interface HeadsetTarget {
  id: 'usb' | 'network';
  label: string;
  url: string;
  /** What the operator has to do first, if anything. */
  command?: string;
  note: string;
  /**
   * True when this URL is a plain-http non-loopback origin, i.e. WebXR will be
   * unavailable there. The UI must say so rather than offering it as a fix.
   */
  insecure: boolean;
}

function buildUrl(loc: LocationLike, protocol: string, host: string): string {
  return `${protocol}//${host}${loc.pathname ?? ''}${loc.search ?? ''}${loc.hash ?? ''}`;
}

/**
 * The URLs worth offering so this page can be opened INSIDE the headset.
 *
 * The USB path is first because it fixes two things at once. `adb reverse
 * tcp:1420 tcp:1420` makes the headset's own `localhost:1420` reach the dev
 * server on the workstation, and `localhost` is a secure context — so WebXR
 * becomes available AND the head-camera panel's relative `/api/...` proxy
 * resolves, without a certificate, a tunnel, or an https dev server.
 *
 * The network path is offered second and FLAGGED when the origin is plain http,
 * because that is precisely the URL that will look like it works and then have
 * no `navigator.xr`.
 *
 * A bare `localhost` URL is NEVER offered under the Network label: inside a
 * Quest, `localhost` means the Quest. Sending an operator to the machine they
 * are standing in is the single most confusing thing this dialog could do, so
 * when the page is already being served from loopback there is no network
 * target at all — there is no address to give.
 */
export function headsetTargets(loc: LocationLike): HeadsetTarget[] {
  const targets: HeadsetTarget[] = [];
  const port = loc.port ?? '';
  const loopback = isLoopbackHost(loc.hostname);

  // Only meaningful for a dev server on an explicit port: `adb reverse` forwards
  // a port, and an origin without one is already on 80/443 — in which case it is
  // either https (nothing to fix) or a deployment, not a workstation.
  if (port) {
    targets.push({
      id: 'usb',
      label: 'USB (adb reverse)',
      url: buildUrl(loc, 'http:', `localhost:${port}`),
      command: `adb reverse tcp:${port} tcp:${port}`,
      note: 'Plug the headset in, run the command, then open this URL in the headset browser. localhost is a secure context, so WebXR and the camera proxy both work.',
      insecure: false,
    });
  }

  if (!loopback && loc.hostname) {
    const host = port ? `${loc.hostname}:${port}` : loc.hostname;
    const insecure = loc.protocol === 'http:';
    targets.push({
      id: 'network',
      label: 'Network',
      url: buildUrl(loc, loc.protocol, host),
      note: insecure
        ? 'Reachable over Wi-Fi, but plain http is not a secure context — the headset browser will not expose WebXR on this URL.'
        : 'Reachable over Wi-Fi on a secure origin — open this in the headset browser.',
      insecure,
    });
  }

  return targets;
}

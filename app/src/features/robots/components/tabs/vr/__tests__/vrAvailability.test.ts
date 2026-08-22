/**
 * @file vrAvailability.test.ts
 * @description Tests for telling "no WebXR" apart from "insecure origin", and
 *              for the URLs offered so the page can be opened in the headset.
 * @feature robots
 */

import { describe, it, expect } from 'vitest';
import { resolveXrAvailability, headsetTargets, type LocationLike } from '../vrAvailability';

function loc(partial: Partial<LocationLike>): LocationLike {
  return {
    protocol: 'http:',
    hostname: 'localhost',
    port: '1420',
    pathname: '/robots/r1',
    search: '?tab=teleop',
    hash: '',
    ...partial,
  };
}

describe('resolveXrAvailability', () => {
  it('is ready on a secure origin with WebXR', () => {
    expect(
      resolveXrAvailability({ hasXr: true, isSecureContext: true, hostname: 'neodem.example' }),
    ).toBe('ready');
  });

  it('is unsupported on a secure origin without WebXR (a desktop browser)', () => {
    expect(
      resolveXrAvailability({ hasXr: false, isSecureContext: true, hostname: 'neodem.example' }),
    ).toBe('unsupported');
  });

  it('reports the INSECURE ORIGIN on a plain-http LAN dev server', () => {
    // The case an operator actually hits. WebXR is secure-context gated, so
    // `navigator.xr` is absent for a reason that has nothing to do with the
    // browser — and telling them to "open this in a headset" is useless advice,
    // because the headset fails in exactly the same way.
    expect(
      resolveXrAvailability({ hasXr: false, isSecureContext: false, hostname: '192.168.1.42' }),
    ).toBe('insecure-origin');
  });

  it('still reports insecure-origin if navigator.xr somehow exists there', () => {
    expect(
      resolveXrAvailability({ hasXr: true, isSecureContext: false, hostname: '192.168.1.42' }),
    ).toBe('insecure-origin');
  });

  it('treats loopback as secure even when isSecureContext is not set', () => {
    for (const hostname of ['localhost', 'app.localhost', '127.0.0.1', '::1', '[::1]', 'LOCALHOST']) {
      expect(resolveXrAvailability({ hasXr: true, isSecureContext: false, hostname })).toBe('ready');
    }
  });

  it('handles a missing hostname', () => {
    expect(
      resolveXrAvailability({ hasXr: true, isSecureContext: true, hostname: '' }),
    ).toBe('ready');
    expect(
      resolveXrAvailability({
        hasXr: true,
        isSecureContext: false,
        hostname: undefined as unknown as string,
      }),
    ).toBe('insecure-origin');
  });
});

describe('headsetTargets', () => {
  it('offers the USB path first, with the adb command and the path preserved', () => {
    const t = headsetTargets(loc({ hostname: '192.168.1.42' }));
    expect(t[0].id).toBe('usb');
    expect(t[0].url).toBe('http://localhost:1420/robots/r1?tab=teleop');
    expect(t[0].command).toBe('adb reverse tcp:1420 tcp:1420');
    expect(t[0].insecure).toBe(false);
  });

  it('flags the network path when the origin is plain http', () => {
    const t = headsetTargets(loc({ hostname: '192.168.1.42' }));
    const net = t.find((x) => x.id === 'network')!;
    expect(net.url).toBe('http://192.168.1.42:1420/robots/r1?tab=teleop');
    expect(net.insecure).toBe(true);
    expect(net.note).toMatch(/not a secure context/);
  });

  it('does not flag an https network path', () => {
    const t = headsetTargets(loc({ protocol: 'https:', hostname: 'neodem.example', port: '' }));
    const net = t.find((x) => x.id === 'network')!;
    expect(net.url).toBe('https://neodem.example/robots/r1?tab=teleop');
    expect(net.insecure).toBe(false);
  });

  it('NEVER offers a bare localhost URL as "Network" — inside a Quest, localhost is the Quest', () => {
    for (const hostname of ['localhost', '127.0.0.1', '::1']) {
      const t = headsetTargets(loc({ hostname }));
      expect(t.some((x) => x.id === 'network')).toBe(false);
      expect(t.map((x) => x.id)).toEqual(['usb']);
    }
  });

  it('omits the USB path when there is no port to reverse', () => {
    const t = headsetTargets(loc({ protocol: 'https:', hostname: 'neodem.example', port: '' }));
    expect(t.map((x) => x.id)).toEqual(['network']);
  });

  it('carries the hash through so a deep link survives the hop into the headset', () => {
    const t = headsetTargets(loc({ hostname: '10.0.0.5', hash: '#vr' }));
    expect(t[0].url).toBe('http://localhost:1420/robots/r1?tab=teleop#vr');
  });

  it('produces nothing offerable for an origin with neither a port nor a routable host', () => {
    expect(headsetTargets(loc({ hostname: '', port: '' }))).toEqual([]);
  });

  it('survives a location with missing string fields', () => {
    const partial = {
      protocol: 'http:',
      hostname: '10.0.0.5',
      port: '1420',
    } as unknown as LocationLike;
    expect(headsetTargets(partial)[0].url).toBe('http://localhost:1420');
  });
});

/**
 * @file config-rtc.test.ts
 * @description Parse-time validation of the VLA_RTC_* knobs (TASK-183)
 * @feature vla
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * `config` is a module-level object literal, so every env read happens once at
 * first import. Each case therefore has to reset the module registry and
 * re-import — there is no reloadConfig() and there should not be one.
 */
async function loadRtc(env: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.resetModules();
  const mod = await import('../config.js');
  return mod.config.vla.rtc;
}

const RTC_KEYS = ['VLA_RTC_ENABLED', 'VLA_RTC_OVERLAP', 'VLA_RTC_BLEND_STEPS'] as const;

describe('config.vla.rtc', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of RTC_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    for (const k of RTC_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    warn.mockRestore();
  });

  it('defaults to off, 0.25 overlap, 5 blend steps and says nothing', async () => {
    expect(await loadRtc({})).toEqual({ enabled: false, overlap: 0.25, blendSteps: 5 });
    expect(warn).not.toHaveBeenCalled();
  });

  it('takes in-range values verbatim, including the 0 and 1 edges', async () => {
    expect(
      await loadRtc({
        VLA_RTC_ENABLED: 'true',
        VLA_RTC_OVERLAP: '1',
        VLA_RTC_BLEND_STEPS: '0',
      })
    ).toEqual({ enabled: true, overlap: 1, blendSteps: 0 });
    expect(warn).not.toHaveBeenCalled();
  });

  it('only `true` enables it — `1` is the orphaned Python runner\'s spelling', async () => {
    expect((await loadRtc({ VLA_RTC_ENABLED: '1' })).enabled).toBe(false);
    expect((await loadRtc({ VLA_RTC_ENABLED: 'true' })).enabled).toBe(true);
  });

  // An overlap of 0 never crosses the threshold and 25 crosses it on every
  // step: one silently disables RTC, the other floods /predict. Both are
  // rejected back to the documented default rather than clamped, so the run
  // matches something an operator can read in .env.example.
  it.each(['0', '-0.25', '25', '0,3', 'abc', ''])(
    'rejects VLA_RTC_OVERLAP=%j back to 0.25, loudly',
    async (raw) => {
      const rtc = await loadRtc({ VLA_RTC_OVERLAP: raw });
      expect(rtc.overlap).toBe(0.25);
      if (raw !== '') {
        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining('VLA_RTC_OVERLAP')
        );
      } else {
        // An empty value is "unset", not "wrong" — no warning for it.
        expect(warn).not.toHaveBeenCalled();
      }
    }
  );

  it.each(['-2', '2.5', 'five'])(
    'rejects VLA_RTC_BLEND_STEPS=%j back to 5, loudly',
    async (raw) => {
      const rtc = await loadRtc({ VLA_RTC_BLEND_STEPS: raw });
      expect(rtc.blendSteps).toBe(5);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('VLA_RTC_BLEND_STEPS'));
    }
  );

  it('a rejected value does not take its neighbour down with it', async () => {
    expect(
      await loadRtc({
        VLA_RTC_ENABLED: 'true',
        VLA_RTC_OVERLAP: '9',
        VLA_RTC_BLEND_STEPS: '3',
      })
    ).toEqual({ enabled: true, overlap: 0.25, blendSteps: 3 });
  });
});

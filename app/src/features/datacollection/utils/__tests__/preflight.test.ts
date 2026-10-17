/**
 * @file preflight.test.ts
 * @description The pre-flight checklist logic (TASK-392): which checks block,
 *              which warn, and the single next action.
 * @feature datacollection
 */

import { describe, it, expect } from 'vitest';
import { buildPreflight, summarizePreflight, type PreflightInputs } from '../preflight';

const base: PreflightInputs = {
  robot: { name: 'G1 EDU', online: true },
  agentConnected: true,
  cameras: { loading: false, names: ['head_camera'], source: 'pc2cam' },
  sessionType: 'keyboard_mouse',
  secureContext: true,
  vrSupported: null,
  gamepadConnected: false,
};

const level = (inp: PreflightInputs, id: string) => buildPreflight(inp).find((i) => i.id === id)?.level;

describe('buildPreflight', () => {
  it('is all ready when everything is there', () => {
    const items = buildPreflight(base);
    expect(items.map((i) => [i.id, i.level])).toEqual([
      ['robot', 'ok'], ['recorder', 'ok'], ['camera', 'ok'], ['input', 'ok'],
    ]);
    expect(items.find((i) => i.id === 'camera')?.detail).toBe('head_camera (pc2cam)');
    expect(summarizePreflight(items)).toEqual({ blocking: false, warnings: 0, next: 'Ready. Press Start recording (Space).' });
  });

  it('blocks on an offline robot and names that as the next action', () => {
    const items = buildPreflight({ ...base, robot: { name: 'G1 EDU', online: false } });
    expect(level({ ...base, robot: { name: 'G1 EDU', online: false } }, 'robot')).toBe('blocking');
    expect(items.find((i) => i.id === 'camera')?.level).toBe('unknown');
    const s = summarizePreflight(items);
    expect(s.blocking).toBe(true);
    expect(s.next).toMatch(/Start the robot agent/);
  });

  it('blocks when the robot is unknown', () => {
    expect(level({ ...base, robot: null }, 'robot')).toBe('blocking');
  });

  it('warns without a camera or an agent stream, but does not block', () => {
    const inp = { ...base, agentConnected: false, cameras: { loading: false, names: [], detail: 'no camera source' } };
    const items = buildPreflight(inp);
    expect(level(inp, 'recorder')).toBe('warning');
    expect(level(inp, 'camera')).toBe('warning');
    expect(items.find((i) => i.id === 'camera')?.detail).toContain('no camera source');
    const s = summarizePreflight(items);
    expect(s).toMatchObject({ blocking: false, warnings: 2 });
    expect(s.next).toMatch(/robot agent is running/);
  });

  it('says it is still checking the cameras', () => {
    expect(level({ ...base, cameras: { loading: true, names: [] } }, 'camera')).toBe('checking');
  });

  it('checks VR: secure context, then headset support', () => {
    const vr = { ...base, sessionType: 'vr_quest' as const };
    expect(level({ ...vr, secureContext: false, vrSupported: false }, 'input')).toBe('warning');
    expect(buildPreflight({ ...vr, secureContext: false, vrSupported: false }).find((i) => i.id === 'input')?.action).toMatch(/HTTPS|adb reverse/);
    expect(level({ ...vr, vrSupported: null }, 'input')).toBe('checking');
    expect(level({ ...vr, vrSupported: false }, 'input')).toBe('warning');
    expect(level({ ...vr, vrSupported: true }, 'input')).toBe('ok');
  });

  it('checks the gamepad', () => {
    const pad = { ...base, sessionType: 'gamepad' as const };
    expect(level(pad, 'input')).toBe('warning');
    expect(level({ ...pad, gamepadConnected: true }, 'input')).toBe('ok');
  });

  it('cannot check a device it does not see', () => {
    expect(level({ ...base, sessionType: 'kinesthetic' }, 'input')).toBe('unknown');
  });

  it('asks for control when leases are on, except for VR', () => {
    const leased = { ...base, lease: { enabled: true, bound: false } };
    expect(level(leased, 'control')).toBe('warning');
    expect(level({ ...leased, lease: { enabled: true, bound: true } }, 'control')).toBe('ok');
    expect(level({ ...leased, lease: { enabled: false, bound: false } }, 'control')).toBeUndefined();
    expect(level({ ...leased, sessionType: 'vr_quest', vrSupported: true }, 'control')).toBeUndefined();
  });
});

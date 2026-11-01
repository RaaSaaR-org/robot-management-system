/**
 * @file preflight.test.ts
 * @description The pre-flight checklist logic (TASK-392): which checks block,
 *              which warn, and the single next action. TASK-442: the wrist
 *              cameras a session records, and a head-only session unchanged.
 * @feature datacollection
 */

import { describe, it, expect } from 'vitest';
import { buildPreflight, summarizePreflight, wristCamerasRow, type PreflightInputs } from '../preflight';

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
    expect(summarizePreflight(items)).toEqual({ blocking: false, warnings: 0, next: 'Ready. Press Start session (Space).' });
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

describe('wrist cameras (TASK-442)', () => {
  const WRISTS = ['left_wrist_camera', 'right_wrist_camera'];
  const served = (...names: string[]) => ({ loading: false, names, source: 'pc2cam' });

  it('adds nothing to a head-only session', () => {
    expect(buildPreflight({ ...base, wristCameras: [] })).toEqual(buildPreflight(base));
    expect(buildPreflight(base).some((i) => i.id === 'wrist_cameras')).toBe(false);
  });

  it('is ok when every chosen wrist is served', () => {
    const items = buildPreflight({ ...base, wristCameras: WRISTS, cameras: served('head_camera', ...WRISTS) });
    expect(items.map((i) => i.id)).toEqual(['robot', 'recorder', 'camera', 'wrist_cameras', 'input']);
    expect(items.find((i) => i.id === 'wrist_cameras')).toMatchObject({ label: 'Wrist cameras', level: 'ok', detail: '2 of 2 live' });
    expect(summarizePreflight(items).blocking).toBe(false);
  });

  it('blocks Record on a chosen wrist the robot does not serve, with a plain reason', () => {
    const items = buildPreflight({ ...base, wristCameras: WRISTS, cameras: served('head_camera', 'right_wrist_camera') });
    const wrist = items.find((i) => i.id === 'wrist_cameras')!;
    expect(wrist).toMatchObject({ level: 'blocking', detail: 'Left wrist offline' });
    const s = summarizePreflight(items);
    expect(s.blocking).toBe(true);
    expect(s.next).toMatch(/^Left wrist camera is not being served\./);
    expect(wristCamerasRow(wrist)).toMatchObject({ id: 'wrist_cameras', label: 'Wrist cameras', status: 'fail', value: 'Left wrist offline' });
  });

  it('names both wrists when neither is served', () => {
    const items = buildPreflight({ ...base, wristCameras: WRISTS, cameras: served('head_camera') });
    const wrist = items.find((i) => i.id === 'wrist_cameras')!;
    expect(wrist.detail).toBe('Both wrists offline');
    expect(wrist.action).toMatch(/^Left wrist camera and right wrist camera are not being served\./);
  });

  it('waits while the robot is offline or the list is loading, without blocking on the wrists', () => {
    const loading = buildPreflight({ ...base, wristCameras: WRISTS, cameras: { loading: true, names: [] } });
    expect(loading.find((i) => i.id === 'wrist_cameras')?.level).toBe('checking');
    expect(summarizePreflight(loading).blocking).toBe(false);
    const offline = buildPreflight({ ...base, robot: { name: 'G1 EDU', online: false }, wristCameras: WRISTS });
    expect(offline.find((i) => i.id === 'wrist_cameras')?.level).toBe('unknown');
    expect(wristCamerasRow(loading.find((i) => i.id === 'wrist_cameras')!).status).toBe('pending');
  });
});

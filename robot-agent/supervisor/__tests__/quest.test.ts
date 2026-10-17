/**
 * @file quest.test.ts
 * @description The Quest on the robot PC's USB (TASK-412): `adb devices -l`
 * fixtures for device / unauthorized / offline / none map to states and hints,
 * the adb path search, the exact argument arrays of connect and open (an
 * execFile spy), and a bad open path refused with 400 before anything runs.
 * @feature supervisor
 */

import { afterEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApi } from '../src/api.js';
import type { Supervisor } from '../src/steps.js';
import {
  findAdb,
  OPEN_PATH,
  parseDevices,
  parseReverse,
  QUEST_HINTS,
  QuestControl,
  type ExecFn,
} from '../src/quest.js';

const ADB = '/home/op/platform-tools/adb';
const SERIAL = '2G0YC5ZG8X0123';
const SESSION = '0b6f1c2e-9a4d-4f5e-8c1b-2d3e4f5a6b7c';

const DEVICES = {
  device: `List of devices attached\n${SERIAL}\tdevice usb:1-1 product:eureka model:Quest_3 device:eureka transport_id:2\n\n`,
  unauthorized: `List of devices attached\n${SERIAL}\tunauthorized usb:1-1 transport_id:3\n\n`,
  offline: `List of devices attached\n${SERIAL}\toffline usb:1-1 transport_id:4\n\n`,
  none: 'List of devices attached\n\n',
};

interface Call {
  file: string;
  args: string[];
}

/** A fake execFile: answers `devices -l` and `reverse --list` from state, records every call. */
function fakeAdb(state: { devices: string; reversed: string; fail?: RegExp }) {
  const calls: Call[] = [];
  const exec: ExecFn = async (file, args) => {
    calls.push({ file, args });
    const joined = args.join(' ');
    if (state.fail?.test(joined)) return { code: 1, stdout: '', stderr: 'error: boom' };
    if (joined === 'devices -l') return { code: 0, stdout: state.devices, stderr: '' };
    if (args.includes('--list')) return { code: 0, stdout: state.reversed, stderr: '' };
    if (args.includes('reverse')) {
      state.reversed = `UsbFfs ${args[args.length - 2]} ${args[args.length - 1]}\n`;
      return { code: 0, stdout: '', stderr: '' };
    }
    return { code: 0, stdout: 'Starting: Intent { act=android.intent.action.VIEW }', stderr: '' };
  };
  return { calls, exec, state };
}

function control(devices: keyof typeof DEVICES, reversed = '') {
  const adb = fakeAdb({ devices: DEVICES[devices], reversed });
  return { ...adb, quest: new QuestControl({ exec: adb.exec, findAdb: () => ADB }) };
}

/** Commands that are not reads: what reached the device. */
const writes = (calls: Call[]) => calls.filter((c) => c.args.join(' ') !== 'devices -l' && !c.args.includes('--list'));

describe('adb output parsing', () => {
  it('maps device, unauthorized, offline and none to states', () => {
    expect(parseDevices(DEVICES.device)).toEqual([{ serial: SERIAL, state: 'device', model: 'Quest 3' }]);
    expect(parseDevices(DEVICES.unauthorized)).toEqual([{ serial: SERIAL, state: 'unauthorized', model: null }]);
    expect(parseDevices(DEVICES.offline)).toEqual([{ serial: SERIAL, state: 'offline', model: null }]);
    expect(parseDevices(DEVICES.none)).toEqual([]);
    expect(parseDevices('* daemon not running; starting now at tcp:5037\n* daemon started successfully\nList of devices attached\n')).toEqual([]);
  });

  it('reads reverse rules with or without a serial column', () => {
    expect(parseReverse(`UsbFfs tcp:1420 tcp:1420\n${SERIAL} tcp:3001 tcp:3001\n`)).toEqual([
      { remote: 'tcp:1420', local: 'tcp:1420' },
      { remote: 'tcp:3001', local: 'tcp:3001' },
    ]);
    expect(parseReverse('')).toEqual([]);
  });
});

describe('GET /quest status', () => {
  it('a connected headset without the reverse rule: press Connect', async () => {
    const { quest, calls } = control('device');
    const st = await quest.status();
    expect(st).toEqual({
      adb: ADB,
      devices: [{ serial: SERIAL, state: 'device', model: 'Quest 3' }],
      reversed: [],
      hint: QUEST_HINTS.notReversed(1420),
    });
    expect(calls).toEqual([
      { file: ADB, args: ['devices', '-l'] },
      { file: ADB, args: ['-s', SERIAL, 'reverse', '--list'] },
    ]);
  });

  it('a connected, reversed headset has no hint', async () => {
    const { quest } = control('device', 'UsbFfs tcp:1420 tcp:1420\n');
    expect(await quest.status()).toMatchObject({ reversed: [{ remote: 'tcp:1420', local: 'tcp:1420' }], hint: null });
  });

  it('mirrors the script for unauthorized (4), offline (4) and no device (3)', async () => {
    expect((await control('unauthorized').quest.status()).hint).toBe(QUEST_HINTS.unauthorized);
    expect((await control('offline').quest.status()).hint).toBe(QUEST_HINTS.offline);
    expect((await control('none').quest.status()).hint).toBe(QUEST_HINTS.none);
    // No reverse --list against a headset that cannot answer it.
    const { quest, calls } = control('unauthorized');
    await quest.status();
    expect(calls).toHaveLength(1);
  });

  it('without adb: adb null and the install hint, nothing executed', async () => {
    const adb = fakeAdb({ devices: DEVICES.device, reversed: '' });
    const quest = new QuestControl({ exec: adb.exec, findAdb: () => null });
    expect(await quest.status()).toEqual({ adb: null, devices: [], reversed: [], hint: QUEST_HINTS.noAdb });
    expect(adb.calls).toEqual([]);
  });
});

describe('findAdb', () => {
  const home = '/home/op';
  it('prefers the profile, then ~/platform-tools, then ~/.local/opt, then PATH', () => {
    const have = (set: string[]) => (p: string) => set.includes(p);
    expect(findAdb({ configured: '/opt/adb', home, isExecutable: have(['/opt/adb', `${home}/platform-tools/adb`]) })).toBe('/opt/adb');
    expect(findAdb({ configured: '/opt/adb', home, isExecutable: have([]) })).toBeNull();
    expect(
      findAdb({ home, pathEnv: '/usr/bin', isExecutable: have([`${home}/platform-tools/adb`, `${home}/.local/opt/platform-tools/adb`]) }),
    ).toBe(`${home}/platform-tools/adb`);
    expect(findAdb({ home, pathEnv: '/usr/bin', isExecutable: have([`${home}/.local/opt/platform-tools/adb`, '/usr/bin/adb']) })).toBe(
      `${home}/.local/opt/platform-tools/adb`,
    );
    expect(findAdb({ home, pathEnv: '/a:/usr/bin', isExecutable: have(['/usr/bin/adb']) })).toBe('/usr/bin/adb');
    expect(findAdb({ home, pathEnv: '/usr/bin', isExecutable: have([]) })).toBeNull();
  });
});

describe('connect and open', () => {
  it('connect runs exactly adb -s <serial> reverse tcp:1420 tcp:1420', async () => {
    const { quest, calls } = control('device');
    const r = await quest.connect(undefined);
    expect(writes(calls)).toEqual([{ file: ADB, args: ['-s', SERIAL, 'reverse', 'tcp:1420', 'tcp:1420'] }]);
    expect(r).toMatchObject({ ok: true, status: 200, serial: SERIAL, quest: { reversed: [{ remote: 'tcp:1420' }], hint: null } });
  });

  it('connect takes another port, and refuses a bad one before running anything', async () => {
    const { quest, calls } = control('device');
    await quest.connect(1442);
    expect(writes(calls)).toEqual([{ file: ADB, args: ['-s', SERIAL, 'reverse', 'tcp:1442', 'tcp:1442'] }]);
    const bad = control('device');
    await expect(bad.quest.connect('1420; reboot')).rejects.toMatchObject({ httpStatus: 400, code: 'bad_port' });
    await expect(bad.quest.connect(80)).rejects.toMatchObject({ httpStatus: 400 });
    expect(bad.calls).toEqual([]);
  });

  it('open starts the Quest browser on localhost with the allowlisted path', async () => {
    const { quest, calls } = control('device', 'UsbFfs tcp:1420 tcp:1420\n');
    const r = await quest.open('/data-collection/live?robot=g1-edu-4', undefined);
    expect(writes(calls)).toEqual([
      {
        file: ADB,
        args: [
          '-s', SERIAL, 'shell', 'am', 'start', '-a', 'android.intent.action.VIEW',
          '-d', 'http://localhost:1420/data-collection/live?robot=g1-edu-4', 'com.oculus.browser',
        ],
      },
    ]);
    expect(r.ok).toBe(true);
    const one = control('device');
    await one.quest.open(`/data-collection/${SESSION}`, 1442);
    expect(writes(one.calls)[0].args).toContain(`http://localhost:1442/data-collection/${SESSION}`);
  });

  it('the open allowlist refuses everything else', async () => {
    for (const bad of [
      'http://evil.example/',
      '/data-collection/live?robot=g1;reboot',
      '/data-collection/live?robot=g1 && rm -rf /',
      '/data-collection/live?robot=g1&x=1',
      '/data-collection/../settings',
      '/data-collection/new',
      `/data-collection/${SESSION}/x`,
      "/data-collection/live?robot=g1'",
      '',
      42,
      null,
    ]) {
      const { quest, calls } = control('device');
      await expect(quest.open(bad, undefined), String(bad)).rejects.toMatchObject({ httpStatus: 400, code: 'bad_path' });
      expect(calls, String(bad)).toEqual([]);
      if (typeof bad === 'string') expect(OPEN_PATH.test(bad)).toBe(false);
    }
  });

  it('without a usable headset: 409 with the hint, no device command', async () => {
    for (const state of ['unauthorized', 'offline', 'none'] as const) {
      const { quest, calls } = control(state);
      const r = await quest.connect(undefined);
      expect(r).toMatchObject({ ok: false, status: 409, code: 'no_device' });
      expect(r.error).toBe(QUEST_HINTS[state]);
      expect(writes(calls)).toEqual([]);
    }
  });

  it('a failing adb reverse is a 502 with adb’s own words', async () => {
    const adb = fakeAdb({ devices: DEVICES.device, reversed: '', fail: /reverse tcp:/ });
    const quest = new QuestControl({ exec: adb.exec, findAdb: () => ADB });
    expect(await quest.connect(undefined)).toMatchObject({ ok: false, status: 502, code: 'reverse_failed', error: 'error: boom' });
  });
});

describe('the HTTP routes', () => {
  const TOKEN = 'test-token-0123456789abcdef';
  let server: Server | undefined;
  afterEach(async () => {
    if (server) await new Promise((r) => server!.close(r));
    server = undefined;
  });

  async function boot(quest: QuestControl): Promise<string> {
    const sup = { profile: { robotId: 'stub-g1', quest: { adb: null } } } as unknown as Supervisor;
    server = createApi(sup, { token: TOKEN, quest });
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }
  const auth = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

  it('needs the token, serves the status, connects, opens, and answers 400 for a bad path with no exec', async () => {
    const { quest, calls } = control('device');
    const base = await boot(quest);
    for (const [method, path] of [['GET', '/quest'], ['POST', '/quest/connect'], ['POST', '/quest/open']]) {
      expect((await fetch(`${base}${path}`, { method })).status, path).toBe(401);
    }
    expect(calls).toEqual([]);

    const st = await fetch(`${base}/quest`, { headers: auth });
    expect(st.status).toBe(200);
    expect(await st.json()).toMatchObject({ adb: ADB, devices: [{ serial: SERIAL, state: 'device' }] });

    const conn = await fetch(`${base}/quest/connect`, { method: 'POST', headers: auth, body: '{}' });
    expect(conn.status).toBe(200);
    expect(await conn.json()).toMatchObject({ ok: true, quest: { reversed: [{ remote: 'tcp:1420' }] } });

    const before = calls.length;
    const bad = await fetch(`${base}/quest/open`, { method: 'POST', headers: auth, body: JSON.stringify({ path: 'http://x/' }) });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ ok: false, code: 'bad_path' });
    expect(calls.length).toBe(before);

    const open = await fetch(`${base}/quest/open`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ path: '/data-collection/live?robot=stub-g1' }),
    });
    expect(open.status).toBe(200);
    expect(writes(calls).at(-1)?.args).toContain('http://localhost:1420/data-collection/live?robot=stub-g1');
  });
});

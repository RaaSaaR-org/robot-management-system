/**
 * @file profile.test.ts
 * @description The profile loader's safety rules, and the two checked-in profiles.
 * @feature supervisor
 */

import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import {
  agentSpec,
  bridgeSpec,
  FORBIDDEN_ENV_KEYS,
  loadProfile,
  ProfileError,
  sidecarSpec,
  simSpec,
  validateProfile,
} from '../src/profile.js';
import { REPO_ROOT } from './helpers.js';

const opts = { repoRoot: '/repo', home: '/home/op' };

function realDoc(): Record<string, unknown> {
  return {
    robotId: 'g1-test',
    robot: 'real',
    iface: 'enp131s0',
    nmProfile: 'g1-robot-lan',
    robotIp: '192.168.123.164',
    hostIp: '192.168.123.222/24',
    pc2Camera: '192.168.123.164:5600',
    ddsDomain: 0,
    python: '${HOME}/env/bin/python',
    cycloneddsHome: '${HOME}/cyclonedds/install',
    ports: { bridge: 6001, sidecar: 8767, agent: 41245 },
    bridge: { script: '${REPO}/robot-agent/hardware/g1_state_bridge_readonly.py', args: [] },
    sidecar: {
      script: '${REPO}/robot-agent/hardware/g1_sidecar.py',
      env: { G1_CAMERA_SOURCE: 'pc2cam' },
      modes: {
        read_only: { G1_LOCO_ENABLED: '0', G1_ALLOW_LIDAR_SWITCH: '0' },
        arm_sdk: { G1_WRITE_MODE: 'arm_sdk', G1_LOCO_ENABLED: 'fsm', G1_DDS_DOMAIN: 0 },
      },
    },
    agent: {
      cwd: '${REPO}/robot-agent',
      command: ['node_modules/.bin/tsx', 'src/index.ts'],
      path: ['${HOME}/.nvm/versions/node/v22.23.2/bin'],
      env: { DOTENV_CONFIG_PATH: '.env.g1-edu', ROBOT_TYPE: 'g1_edu' },
    },
  };
}

function simDoc(): Record<string, unknown> {
  const d = realDoc();
  d.robot = 'sim';
  d.iface = 'lo';
  d.ddsDomain = 42;
  (d.sidecar as { modes: { arm_sdk: Record<string, unknown> } }).modes.arm_sdk.G1_DDS_DOMAIN = '42';
  d.sim = { script: '${REPO}/robot-agent/hardware/sim_g1_dds/sim_node.py', args: ['--quiet'] };
  return d;
}

function expectRefused(doc: Record<string, unknown>, match: RegExp): void {
  expect(() => validateProfile(doc, opts)).toThrow(ProfileError);
  expect(() => validateProfile(doc, opts)).toThrow(match);
}

describe('profile loader', () => {
  it('accepts a real profile and expands ${HOME} and ${REPO}', () => {
    const p = validateProfile(realDoc(), opts);
    expect(p.python).toBe('/home/op/env/bin/python');
    expect(p.bridge.script).toBe('/repo/robot-agent/hardware/g1_state_bridge_readonly.py');
    expect(p.bridge.probe).toBe('/repo/robot-agent/hardware/bridge_probe.py');
    expect(p.agent.command[0]).toBe('/repo/robot-agent/node_modules/.bin/tsx');
    expect(p.pc2Camera).toEqual({ host: '192.168.123.164', port: 5600 });
  });

  it.each(['G1_READ_ONLY', 'G1_ARM_ALLOW_UNKNOWN_FSM'])('rejects %s in every env block', (key) => {
    for (const where of ['common', 'read_only', 'arm_sdk', 'agent', 'bridge'] as const) {
      const d = realDoc();
      const sc = d.sidecar as { env: Record<string, unknown>; modes: Record<string, Record<string, unknown>> };
      if (where === 'common') sc.env[key] = '1';
      else if (where === 'agent') (d.agent as { env: Record<string, unknown> }).env[key] = '1';
      else if (where === 'bridge') (d.bridge as Record<string, unknown>).env = { [key]: '0' };
      else sc.modes[where][key] = key === 'G1_READ_ONLY' ? '0' : '1';
      expectRefused(d, new RegExp(`${key} is forbidden`));
    }
  });

  it('rejects DDS domain 0 in a sim profile', () => {
    const d = simDoc();
    d.ddsDomain = 0;
    expectRefused(d, /domain 0 is the REAL robot/i);
  });

  it('accepts domain 0 only with robot: real', () => {
    expect(validateProfile(realDoc(), opts).ddsDomain).toBe(0);
    expect(validateProfile(simDoc(), opts).ddsDomain).toBe(42);
  });

  it('keeps a sim profile on loopback', () => {
    const d = simDoc();
    d.iface = 'enp131s0';
    expectRefused(d, /loopback/);
  });

  it('refuses a mode block whose G1_DDS_DOMAIN contradicts ddsDomain', () => {
    const d = simDoc();
    (d.sidecar as { modes: { arm_sdk: Record<string, unknown> } }).modes.arm_sdk.G1_DDS_DOMAIN = '0';
    expectRefused(d, /contradicts profile.ddsDomain/);
  });

  it('refuses walking (G1_LOCO_ENABLED=1) in a real profile', () => {
    const d = realDoc();
    (d.sidecar as { modes: { arm_sdk: Record<string, unknown> } }).modes.arm_sdk.G1_LOCO_ENABLED = '1';
    expectRefused(d, /enables walking/);
  });

  it('refuses a read_only block that sets arm_sdk, and an arm_sdk block that does not', () => {
    const a = realDoc();
    (a.sidecar as { modes: { read_only: Record<string, unknown> } }).modes.read_only.G1_WRITE_MODE = 'arm_sdk';
    expectRefused(a, /must be read_only/);
    const b = realDoc();
    delete (b.sidecar as { modes: { arm_sdk: Record<string, unknown> } }).modes.arm_sdk.G1_WRITE_MODE;
    expectRefused(b, /must set G1_WRITE_MODE: arm_sdk/);
  });

  it('refuses `tsx watch` for the agent', () => {
    const d = realDoc();
    (d.agent as { command: string[] }).command = ['node_modules/.bin/tsx', 'watch', 'src/index.ts'];
    expectRefused(d, /watch/);
  });

  it('refuses keys and bridge args the supervisor composes itself', () => {
    const a = realDoc();
    (a.bridge as { args: string[] }).args = ['--domain', '1'];
    expectRefused(a, /--domain is set by the supervisor/);
    const b = realDoc();
    (b.agent as { env: Record<string, unknown> }).env.PORT = '1';
    expectRefused(b, /PORT is set by the supervisor/);
  });

  it('refuses unknown ${VARS} instead of expanding them to nothing', () => {
    const d = realDoc();
    d.python = '${PYENV}/bin/python';
    expectRefused(d, /unknown variable/);
  });

  it('builds child environments from an allowlist only', () => {
    const p = validateProfile(realDoc(), opts);
    const parent = {
      HOME: '/home/op', LANG: 'C.UTF-8', SECRET_KEY: 'x', ROBOT_SUPERVISOR_TOKEN: 'tok',
      G1_READ_ONLY: '0', PATH: '/evil/bin', LD_PRELOAD: '/evil.so',
    };
    for (const spec of [sidecarSpec(p, 'read_only', parent), sidecarSpec(p, 'arm_sdk', parent), bridgeSpec(p, true, parent), agentSpec(p, parent)]) {
      for (const k of FORBIDDEN_ENV_KEYS) expect(spec.env).not.toHaveProperty(k);
      expect(spec.env).not.toHaveProperty('SECRET_KEY');
      expect(spec.env.PATH).not.toContain('/evil');
      expect(spec.env.HOME).toBe('/home/op');
    }
    const ro = sidecarSpec(p, 'read_only', parent).env;
    expect(ro.G1_WRITE_MODE).toBeUndefined();
    expect(ro.G1_LOCO_ENABLED).toBe('0');
    expect(ro.G1_DDS_DOMAIN).toBe('0');
    expect(ro.G1_LOWSTATE_ENDPOINT).toBe('tcp://127.0.0.1:6001');
    const arm = sidecarSpec(p, 'arm_sdk', parent).env;
    expect(arm.G1_WRITE_MODE).toBe('arm_sdk');
    expect(arm.G1_LOCO_ENABLED).toBe('fsm');
    expect(bridgeSpec(p, true, parent).args).toEqual(expect.arrayContaining(['--bind', '127.0.0.1', '--domain', '0', '--iface', 'enp131s0']));
    expect(bridgeSpec(p, false, parent).args).not.toContain('--bind');
    expect(agentSpec(p, parent).env).toMatchObject({ PORT: '41245', HARDWARE_SIDECAR_URL: 'http://127.0.0.1:8767', ROBOT_ID: 'g1-test' });
  });

  it('the simulator gets the profile domain and loopback', () => {
    const p = validateProfile(simDoc(), opts);
    expect(simSpec(p, {}).args).toEqual(expect.arrayContaining(['--domain', '42', '--iface', 'lo']));
  });
});

describe('checked-in profiles', () => {
  const dir = join(REPO_ROOT, 'robot-agent', 'hardware', 'profiles');

  it('g1-edu-4.yaml is the real robot, read_only by default, port 41245', () => {
    const p = loadProfile(join(dir, 'g1-edu-4.yaml'), { repoRoot: REPO_ROOT, home: '/home/op' });
    expect(p).toMatchObject({ robotId: 'g1-edu-4', robot: 'real', iface: 'enp131s0', ddsDomain: 0, nmProfile: 'g1-robot-lan' });
    expect(p.ports).toMatchObject({ bridge: 6001, sidecar: 8767, agent: 41245 });
    expect(p.sidecar.modes.read_only.G1_LOCO_ENABLED).toBe('0');
    expect(p.sidecar.modes.arm_sdk).toMatchObject({ G1_WRITE_MODE: 'arm_sdk', G1_LOCO_ENABLED: 'fsm' });
    expect(p.agent.command).not.toContain('watch');
  });

  it('sim-g1-edu-dev.yaml stays off domain 0/1, on loopback, off the dev ports', () => {
    const p = loadProfile(join(dir, 'sim-g1-edu-dev.yaml'), { repoRoot: REPO_ROOT, home: '/home/op' });
    expect(p.robot).toBe('sim');
    expect(p.iface).toBe('lo');
    expect(p.ddsDomain).toBe(42);
    const ports = [p.ports.bridge, p.ports.sidecar, p.ports.agent, p.ports.simHttp];
    for (const devPort of [6001, 8767, 8777, 41245, 41246, 3001]) expect(ports).not.toContain(devPort);
  });
});

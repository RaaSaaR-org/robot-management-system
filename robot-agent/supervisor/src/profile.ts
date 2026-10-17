/**
 * @file profile.ts
 * @description Loads and validates a robot profile (robot-agent/hardware/profiles/*.yaml)
 * and builds each child's environment from an allowlist. The loader is where the
 * supervisor's configuration-level safety rules live: it refuses G1_READ_ONLY and
 * G1_ARM_ALLOW_UNKNOWN_FSM outright, accepts DDS domain 0 only in a `robot: real`
 * profile, keeps a sim profile on loopback, and never lets a real profile enable
 * walking (G1_LOCO_ENABLED=1).
 * @feature supervisor
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';

export type RobotKind = 'real' | 'sim';
export type SidecarMode = 'read_only' | 'arm_sdk';
export type ProcName = 'sim' | 'bridge' | 'sidecar' | 'agent';
export type LocoGate = 'off' | 'fsm' | 'full';

export interface Timeouts {
  /** How long the bridge may take to put rt/lowstate on its ZMQ port. */
  bridgeS: number;
  /** How long the sidecar may take to report a ready /health. */
  sidecarS: number;
  /** How long the agent may take to answer /api/v1/health healthy. */
  agentS: number;
  /** How long the simulator may take to answer its /health (sim profiles). */
  simS: number;
}

export interface Profile {
  robotId: string;
  robot: RobotKind;
  iface: string;
  nmProfile: string | null;
  robotIp: string | null;
  /** CIDR as written in the profile, e.g. 192.168.123.222/24. */
  hostIp: string | null;
  pc2Camera: { host: string; port: number } | null;
  ddsDomain: number;
  python: string;
  cycloneddsHome: string | null;
  ports: { bridge: number; sidecar: number; agent: number; simHttp: number | null };
  bridge: { script: string; args: string[]; probe: string; env: Record<string, string> };
  sidecar: {
    script: string;
    env: Record<string, string>;
    modes: Record<SidecarMode, Record<string, string>>;
  };
  agent: {
    cwd: string;
    command: string[];
    path: string[];
    env: Record<string, string>;
  };
  sim: { script: string; cwd: string; args: string[]; env: Record<string, string> } | null;
  timeouts: Timeouts;
}

export class ProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProfileError';
  }
}

/**
 * Keys no profile may set, for any child. G1_READ_ONLY=0 was the lerobot rt/lowcmd
 * path that drops a standing robot; G1_ARM_ALLOW_UNKNOWN_FSM=1 lets /arm skip the
 * balance check. Neither is a supervisor decision — a person at the robot sets
 * them by hand, if ever. The supervisor's own token must never reach a child.
 */
export const FORBIDDEN_ENV_KEYS = [
  'G1_READ_ONLY',
  'G1_ARM_ALLOW_UNKNOWN_FSM',
  'ROBOT_SUPERVISOR_TOKEN',
  'LD_PRELOAD',
  'NODE_OPTIONS',
] as const;

/** What a child may inherit from the supervisor's own environment. Nothing else is. */
export const INHERITED_ENV_KEYS = ['HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'TZ'] as const;

/** PATH tail every child gets after the profile's own entries. */
export const BASE_PATH = ['/usr/local/bin', '/usr/bin', '/bin'];

const DEFAULT_TIMEOUTS: Timeouts = { bridgeS: 15, sidecarS: 45, agentS: 20, simS: 60 };

/** Bridge args the supervisor composes itself from the profile's fields. */
const BRIDGE_OWNED_ARGS = ['--iface', '--domain', '--port', '--bind'];

/** Sidecar keys the supervisor composes from the profile's fields. */
const SIDECAR_OWNED_KEYS = [
  'G1_SIDECAR_PORT',
  'G1_LOWSTATE_ENDPOINT',
  'G1_DDS_IFACE',
  'G1_LIDAR_DDS_IFACE',
  'G1_NET_INTERFACE',
  'G1_ROBOT_ID',
];

/** Agent keys the supervisor composes from the profile's fields. */
const AGENT_OWNED_KEYS = ['PORT', 'HARDWARE_SIDECAR_URL', 'ROBOT_ID'];

export interface LoadOptions {
  /** Repository root, substituted for ${REPO}. */
  repoRoot: string;
  /** Home directory, substituted for ${HOME}. Defaults to os.homedir(). */
  home?: string;
}

/** Expand ${HOME} and ${REPO}. Any other ${...} is an error, not an empty string. */
export function expandVars(value: string, opts: LoadOptions, where: string): string {
  const home = opts.home ?? homedir();
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_m, name: string) => {
    if (name === 'HOME') return home;
    if (name === 'REPO') return opts.repoRoot;
    throw new ProfileError(`${where}: unknown variable \${${name}} (only \${HOME} and \${REPO} expand)`);
  });
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(obj: Record<string, unknown>, key: string, where: string): string {
  const v = obj[key];
  if (typeof v !== 'string' || v.trim() === '') {
    throw new ProfileError(`${where}.${key} must be a non-empty string`);
  }
  return v.trim();
}

function optStr(obj: Record<string, unknown>, key: string, where: string): string | null {
  const v = obj[key];
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string') throw new ProfileError(`${where}.${key} must be a string`);
  return v.trim();
}

function port(v: unknown, where: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 65535) {
    throw new ProfileError(`${where} must be a TCP port (1-65535), got ${JSON.stringify(v)}`);
  }
  return v;
}

function strList(v: unknown, where: string, opts: LoadOptions): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new ProfileError(`${where} must be a list`);
  return v.map((item, i) => {
    if (typeof item !== 'string' && typeof item !== 'number') {
      throw new ProfileError(`${where}[${i}] must be a string`);
    }
    return expandVars(String(item), opts, `${where}[${i}]`);
  });
}

/** A YAML map of env vars. Values are stringified (YAML `0` → "0"). */
function envMap(v: unknown, where: string, opts: LoadOptions): Record<string, string> {
  if (v === undefined || v === null) return {};
  if (!isRecord(v)) throw new ProfileError(`${where} must be a map of NAME: value`);
  const out: Record<string, string> = {};
  for (const [k, raw] of Object.entries(v)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) {
      throw new ProfileError(`${where}: ${JSON.stringify(k)} is not an environment variable name`);
    }
    if ((FORBIDDEN_ENV_KEYS as readonly string[]).includes(k)) {
      throw new ProfileError(
        `${where}: ${k} is forbidden in a supervisor profile` +
          (k === 'G1_READ_ONLY'
            ? ' (G1_READ_ONLY=0 is the removed rt/lowcmd path; the write mode is G1_WRITE_MODE)'
            : k === 'G1_ARM_ALLOW_UNKNOWN_FSM'
              ? ' (it lets /arm skip the measured-balance check; only a person at the robot may set it)'
              : ''),
      );
    }
    if (raw === null || raw === undefined || isRecord(raw) || Array.isArray(raw)) {
      throw new ProfileError(`${where}.${k} must be a scalar`);
    }
    out[k] = expandVars(String(raw), opts, `${where}.${k}`);
  }
  return out;
}

function absPath(p: string, base: string): string {
  return isAbsolute(p) ? p : resolve(base, p);
}

/** The loco gate a sidecar env will run with, as /health reports it (`loco.gate`). */
export function locoGateOf(env: Record<string, string>): LocoGate {
  const raw = (env.G1_LOCO_ENABLED ?? '').trim().toLowerCase();
  if (raw === 'fsm') return 'fsm';
  if (raw === '1' || raw === 'true' || raw === 'full' || raw === 'yes' || raw === 'on') return 'full';
  return 'off';
}

/** Parse + validate a profile object (already YAML-decoded). */
export function validateProfile(doc: unknown, opts: LoadOptions): Profile {
  if (!isRecord(doc)) throw new ProfileError('profile must be a YAML map');
  const where = 'profile';

  const robotId = str(doc, 'robotId', where);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(robotId)) {
    throw new ProfileError(`profile.robotId ${JSON.stringify(robotId)} may hold only letters, digits, . _ -`);
  }
  const robot = str(doc, 'robot', where);
  if (robot !== 'real' && robot !== 'sim') {
    throw new ProfileError(`profile.robot must be 'real' or 'sim', got ${JSON.stringify(robot)}`);
  }
  const iface = str(doc, 'iface', where);
  const ddsDomain = doc.ddsDomain;
  if (typeof ddsDomain !== 'number' || !Number.isInteger(ddsDomain) || ddsDomain < 0 || ddsDomain > 232) {
    throw new ProfileError(`profile.ddsDomain must be an integer 0-232, got ${JSON.stringify(ddsDomain)}`);
  }
  if (ddsDomain === 0 && robot !== 'real') {
    throw new ProfileError(
      'profile.ddsDomain 0 is the REAL robot — only a profile with robot: real may use it',
    );
  }
  if (robot === 'sim' && iface !== 'lo') {
    throw new ProfileError(`a sim profile runs DDS on loopback only (iface: lo), got ${JSON.stringify(iface)}`);
  }

  const cam = optStr(doc, 'pc2Camera', where);
  let pc2Camera: Profile['pc2Camera'] = null;
  if (cam) {
    const m = /^([^:\s]+):(\d+)$/.exec(cam);
    if (!m) throw new ProfileError(`profile.pc2Camera must be host:port, got ${JSON.stringify(cam)}`);
    pc2Camera = { host: m[1], port: port(Number(m[2]), 'profile.pc2Camera port') };
  }

  const python = expandVars(str(doc, 'python', where), opts, 'profile.python');
  const cyc = optStr(doc, 'cycloneddsHome', where);
  const cycloneddsHome = cyc ? expandVars(cyc, opts, 'profile.cycloneddsHome') : null;

  if (!isRecord(doc.ports)) throw new ProfileError('profile.ports must be a map');
  const ports = {
    bridge: port(doc.ports.bridge, 'profile.ports.bridge'),
    sidecar: port(doc.ports.sidecar, 'profile.ports.sidecar'),
    agent: port(doc.ports.agent, 'profile.ports.agent'),
    simHttp: doc.ports.simHttp === undefined || doc.ports.simHttp === null
      ? null
      : port(doc.ports.simHttp, 'profile.ports.simHttp'),
  };
  const used = [ports.bridge, ports.sidecar, ports.agent, ports.simHttp].filter((p): p is number => p !== null);
  if (new Set(used).size !== used.length) {
    throw new ProfileError(`profile.ports must be distinct, got ${used.join(', ')}`);
  }

  // ---- bridge
  if (!isRecord(doc.bridge)) throw new ProfileError('profile.bridge must be a map');
  const bridgeScript = absPath(expandVars(str(doc.bridge, 'script', 'profile.bridge'), opts, 'profile.bridge.script'), opts.repoRoot);
  const bridgeArgs = strList(doc.bridge.args, 'profile.bridge.args', opts);
  for (const a of bridgeArgs) {
    const flag = a.split('=')[0];
    if (BRIDGE_OWNED_ARGS.includes(flag)) {
      throw new ProfileError(
        `profile.bridge.args: ${flag} is set by the supervisor from the profile's iface/ddsDomain/ports`,
      );
    }
  }
  const bridgeEnv = envMap(doc.bridge.env, 'profile.bridge.env', opts);
  const probeRaw = optStr(doc.bridge, 'probe', 'profile.bridge');
  const bridgeProbe = probeRaw
    ? absPath(expandVars(probeRaw, opts, 'profile.bridge.probe'), opts.repoRoot)
    : resolve(opts.repoRoot, 'robot-agent/hardware/bridge_probe.py');

  // ---- sidecar
  if (!isRecord(doc.sidecar)) throw new ProfileError('profile.sidecar must be a map');
  const sidecarScript = absPath(expandVars(str(doc.sidecar, 'script', 'profile.sidecar'), opts, 'profile.sidecar.script'), opts.repoRoot);
  const sidecarEnv = envMap(doc.sidecar.env, 'profile.sidecar.env', opts);
  if (!isRecord(doc.sidecar.modes)) throw new ProfileError('profile.sidecar.modes must be a map with read_only and arm_sdk');
  const roEnv = envMap(doc.sidecar.modes.read_only, 'profile.sidecar.modes.read_only', opts);
  const armEnv = envMap(doc.sidecar.modes.arm_sdk, 'profile.sidecar.modes.arm_sdk', opts);
  if (doc.sidecar.modes.read_only === undefined || doc.sidecar.modes.arm_sdk === undefined) {
    throw new ProfileError('profile.sidecar.modes needs both read_only and arm_sdk blocks');
  }
  for (const [label, env] of [
    ['profile.sidecar.env', sidecarEnv],
    ['profile.sidecar.modes.read_only', roEnv],
    ['profile.sidecar.modes.arm_sdk', armEnv],
  ] as const) {
    for (const k of SIDECAR_OWNED_KEYS) {
      if (k in env) throw new ProfileError(`${label}: ${k} is set by the supervisor from the profile's fields`);
    }
    for (const k of ['G1_DDS_DOMAIN', 'G1_LIDAR_DDS_DOMAIN']) {
      if (k in env && Number(env[k]) !== ddsDomain) {
        throw new ProfileError(`${label}: ${k}=${env[k]} contradicts profile.ddsDomain ${ddsDomain}`);
      }
    }
  }
  if ('G1_WRITE_MODE' in sidecarEnv) {
    throw new ProfileError('profile.sidecar.env: G1_WRITE_MODE belongs in a mode block, not the common env');
  }
  const roMode = ({ ...sidecarEnv, ...roEnv }.G1_WRITE_MODE ?? 'read_only').trim().toLowerCase();
  if (roMode !== 'read_only') {
    throw new ProfileError(`profile.sidecar.modes.read_only sets G1_WRITE_MODE=${roMode}; it must be read_only or unset`);
  }
  if ((armEnv.G1_WRITE_MODE ?? '').trim().toLowerCase() !== 'arm_sdk') {
    throw new ProfileError('profile.sidecar.modes.arm_sdk must set G1_WRITE_MODE: arm_sdk');
  }
  if (robot === 'real') {
    for (const [label, env] of [
      ['read_only', { ...sidecarEnv, ...roEnv }],
      ['arm_sdk', { ...sidecarEnv, ...armEnv }],
    ] as const) {
      if (locoGateOf(env) === 'full') {
        throw new ProfileError(
          `profile.sidecar.modes.${label}: G1_LOCO_ENABLED=${env.G1_LOCO_ENABLED} enables walking — ` +
            "a real-robot profile may use only 0 or 'fsm'",
        );
      }
    }
  }

  // ---- agent
  if (!isRecord(doc.agent)) throw new ProfileError('profile.agent must be a map');
  const agentCwd = absPath(expandVars(str(doc.agent, 'cwd', 'profile.agent'), opts, 'profile.agent.cwd'), opts.repoRoot);
  const agentCommand = strList(doc.agent.command, 'profile.agent.command', opts);
  if (agentCommand.length === 0) throw new ProfileError('profile.agent.command must not be empty');
  if (agentCommand.includes('watch')) {
    throw new ProfileError(
      "profile.agent.command must not use 'watch': a reload drops the agent's /action stream mid-teleop",
    );
  }
  if (agentCommand[0].includes('/')) agentCommand[0] = absPath(agentCommand[0], agentCwd);
  const agentPath = strList(doc.agent.path, 'profile.agent.path', opts);
  const agentEnv = envMap(doc.agent.env, 'profile.agent.env', opts);
  for (const k of AGENT_OWNED_KEYS) {
    if (k in agentEnv) throw new ProfileError(`profile.agent.env: ${k} is set by the supervisor from the profile's fields`);
  }
  if ('PATH' in agentEnv) throw new ProfileError('profile.agent.env: set PATH through profile.agent.path');

  // ---- sim (sim profiles only)
  let sim: Profile['sim'] = null;
  if (robot === 'sim') {
    if (!isRecord(doc.sim)) throw new ProfileError('a sim profile needs a profile.sim block (the simulator it runs)');
    const simScript = absPath(expandVars(str(doc.sim, 'script', 'profile.sim'), opts, 'profile.sim.script'), opts.repoRoot);
    const simArgs = strList(doc.sim.args, 'profile.sim.args', opts);
    for (const a of simArgs) {
      const flag = a.split('=')[0];
      if (['--domain', '--iface', '--http-port'].includes(flag)) {
        throw new ProfileError(`profile.sim.args: ${flag} is set by the supervisor from the profile's fields`);
      }
    }
    sim = {
      script: simScript,
      cwd: doc.sim.cwd ? absPath(expandVars(String(doc.sim.cwd), opts, 'profile.sim.cwd'), opts.repoRoot) : resolve(simScript, '..'),
      args: simArgs,
      env: envMap(doc.sim.env, 'profile.sim.env', opts),
    };
  } else if (doc.sim !== undefined) {
    throw new ProfileError('profile.sim is only allowed with robot: sim');
  }

  // ---- timeouts
  const timeouts: Timeouts = { ...DEFAULT_TIMEOUTS };
  if (doc.timeouts !== undefined) {
    if (!isRecord(doc.timeouts)) throw new ProfileError('profile.timeouts must be a map');
    for (const [k, v] of Object.entries(doc.timeouts)) {
      if (!(k in DEFAULT_TIMEOUTS)) throw new ProfileError(`profile.timeouts.${k} is not a known timeout`);
      if (typeof v !== 'number' || !(v > 0) || v > 600) {
        throw new ProfileError(`profile.timeouts.${k} must be seconds in (0, 600]`);
      }
      timeouts[k as keyof Timeouts] = v;
    }
  }

  const hostIp = optStr(doc, 'hostIp', where);
  if (hostIp && !/^\d{1,3}(\.\d{1,3}){3}(\/\d{1,2})?$/.test(hostIp)) {
    throw new ProfileError(`profile.hostIp must be an IPv4 address (optionally /prefix), got ${hostIp}`);
  }
  if (robot === 'real' && !hostIp) throw new ProfileError('a real profile needs profile.hostIp');
  const robotIp = optStr(doc, 'robotIp', where);
  if (robot === 'real' && !robotIp) throw new ProfileError('a real profile needs profile.robotIp');

  return {
    robotId,
    robot,
    iface,
    nmProfile: optStr(doc, 'nmProfile', where),
    robotIp,
    hostIp,
    pc2Camera,
    ddsDomain,
    python,
    cycloneddsHome,
    ports,
    bridge: { script: bridgeScript, args: bridgeArgs, probe: bridgeProbe, env: bridgeEnv },
    sidecar: { script: sidecarScript, env: sidecarEnv, modes: { read_only: roEnv, arm_sdk: armEnv } },
    agent: { cwd: agentCwd, command: agentCommand, path: agentPath, env: agentEnv },
    sim,
    timeouts,
  };
}

/** Read, parse and validate a profile file. Throws ProfileError with a plain sentence. */
export function loadProfile(path: string, opts: LoadOptions): Profile {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    throw new ProfileError(`cannot read profile ${path}: ${(e as Error).message}`);
  }
  let doc: unknown;
  try {
    doc = parseYaml(text);
  } catch (e) {
    throw new ProfileError(`profile ${path} is not valid YAML: ${(e as Error).message}`);
  }
  return validateProfile(doc, opts);
}

/** The child environment: an allowlist from our own env plus what the profile says. */
function baseEnv(parent: NodeJS.ProcessEnv, extraPath: string[]): Record<string, string> {
  const env: Record<string, string> = {};
  for (const k of INHERITED_ENV_KEYS) {
    const v = parent[k];
    if (v !== undefined) env[k] = v;
  }
  env.PATH = [...extraPath, ...BASE_PATH].join(':');
  return env;
}

function pythonEnv(profile: Profile, parent: NodeJS.ProcessEnv): Record<string, string> {
  const env = baseEnv(parent, [resolve(profile.python, '..')]);
  env.PYTHONUNBUFFERED = '1';
  env.PYTHONIOENCODING = 'utf-8';
  if (profile.cycloneddsHome) env.CYCLONEDDS_HOME = profile.cycloneddsHome;
  return env;
}

export interface ChildSpec {
  proc: ProcName;
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  mode: SidecarMode | null;
}

/** Final guard: whatever was merged, a forbidden key never reaches a child. */
function assertClean(spec: ChildSpec): ChildSpec {
  for (const k of FORBIDDEN_ENV_KEYS) {
    if (k in spec.env) throw new ProfileError(`${spec.proc}: refusing to start a child with ${k} set`);
  }
  return spec;
}

export function sidecarEnvFor(profile: Profile, mode: SidecarMode, parent: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {
    ...pythonEnv(profile, parent),
    ...profile.sidecar.env,
    ...profile.sidecar.modes[mode],
    G1_SIDECAR_PORT: String(profile.ports.sidecar),
    G1_LOWSTATE_ENDPOINT: `tcp://127.0.0.1:${profile.ports.bridge}`,
    G1_DDS_DOMAIN: String(profile.ddsDomain),
    G1_DDS_IFACE: profile.iface,
    G1_NET_INTERFACE: profile.iface,
    G1_ROBOT_ID: profile.robotId,
  };
  if (profile.robotIp && !('G1_ROBOT_IP' in env)) env.G1_ROBOT_IP = profile.robotIp;
  if (profile.pc2Camera) {
    if (!('G1_PC2_CAMERA_HOST' in env)) env.G1_PC2_CAMERA_HOST = profile.pc2Camera.host;
    if (!('G1_PC2_CAMERA_PORT' in env)) env.G1_PC2_CAMERA_PORT = String(profile.pc2Camera.port);
  }
  return env;
}

export function sidecarSpec(profile: Profile, mode: SidecarMode, parent: NodeJS.ProcessEnv = process.env): ChildSpec {
  return assertClean({
    proc: 'sidecar',
    command: profile.python,
    args: ['-u', profile.sidecar.script],
    cwd: resolve(profile.sidecar.script, '..'),
    env: sidecarEnvFor(profile, mode, parent),
    mode,
  });
}

export function bridgeSpec(profile: Profile, bindSupported: boolean, parent: NodeJS.ProcessEnv = process.env): ChildSpec {
  const args = ['-u', profile.bridge.script, '--iface', profile.iface, '--domain', String(profile.ddsDomain),
    '--port', String(profile.ports.bridge)];
  if (bindSupported) args.push('--bind', '127.0.0.1');
  args.push(...profile.bridge.args);
  return assertClean({
    proc: 'bridge',
    command: profile.python,
    args,
    cwd: resolve(profile.bridge.script, '..'),
    env: { ...pythonEnv(profile, parent), ...profile.bridge.env },
    mode: null,
  });
}

export function agentSpec(profile: Profile, parent: NodeJS.ProcessEnv = process.env): ChildSpec {
  const env = {
    ...baseEnv(parent, profile.agent.path),
    ...profile.agent.env,
    PORT: String(profile.ports.agent),
    HARDWARE_SIDECAR_URL: `http://127.0.0.1:${profile.ports.sidecar}`,
    ROBOT_ID: profile.robotId,
  };
  const [command, ...args] = profile.agent.command;
  return assertClean({ proc: 'agent', command, args, cwd: profile.agent.cwd, env, mode: null });
}

export function simSpec(profile: Profile, parent: NodeJS.ProcessEnv = process.env): ChildSpec {
  if (!profile.sim) throw new ProfileError('this profile has no simulator');
  const args = ['-u', profile.sim.script, ...profile.sim.args, '--domain', String(profile.ddsDomain),
    '--iface', profile.iface];
  if (profile.ports.simHttp !== null) args.push('--http-port', String(profile.ports.simHttp));
  return assertClean({
    proc: 'sim',
    command: profile.python,
    args,
    cwd: profile.sim.cwd,
    env: { ...pythonEnv(profile, parent), ...profile.sim.env },
    mode: null,
  });
}

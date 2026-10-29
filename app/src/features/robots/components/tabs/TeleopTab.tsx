/**
 * @file TeleopTab.tsx
 * @description Teleoperation tab — keyboard teleop and VR teleop (Meta Quest), one panel each
 * @feature robots
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Keyboard, Plug, Unplug } from 'lucide-react';
import { Button, EmptyState, Panel, StatusTag, toast } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import type { TeleopTabProps } from './types';
import { VRTeleopSection } from './vr/VRTeleopSection';
import { ControlLeaseBar } from './ControlLeaseBar';
import { useControlLease, type LeaseSocket } from '../../hooks/useControlLease';
import { openTeleopSocket } from './vr/vrUrls';
import { RobotReadinessPanel, type ReadinessLease } from '../readiness/RobotReadinessPanel';

// ============================================================================
// TYPES & HELPERS
// ============================================================================

/** A teleoperable joint as advertised by the robot agent's teleop endpoint. */
interface TeleopJoint {
  name: string;
  limitLower: number;
  limitUpper: number;
  defaultPosition: number;
  /**
   * False for a joint the robot's write path never commands — on a real G1
   * the legs, the waist and the fingers of a hand without live state
   * (TASK-421). Absent from an older agent: treated as drivable.
   */
  drivable?: boolean;
}

/** Whether a joint takes commands (absent = an older agent = yes). */
const isDrivable = (joint: TeleopJoint | undefined): boolean => joint !== undefined && joint.drivable !== false;

/**
 * The next drivable joint from `from` in `step` direction, or `from` when
 * there is none. Non-drivable joints are skipped so ↑/↓ never lands on a leg.
 */
function nextDrivable(joints: TeleopJoint[], from: number, step: number): number {
  for (let i = from + step; i >= 0 && i < joints.length; i += step) {
    if (isDrivable(joints[i])) return i;
  }
  return from;
}

/** How long the same agent error stays quiet after its toast, in ms. */
const ERROR_TOAST_QUIET_MS = 3_000;

/** Controls legend (embodiment-agnostic). */
const KEY_DISPLAY: Array<{ keys: string[]; label: string }> = [
  { keys: ['↑', '↓'], label: 'Select joint' },
  { keys: ['←', '→'], label: 'Move joint' },
  { keys: ['H'], label: 'Home' },
  { keys: ['Space'], label: 'Stop' },
];

/** Turn a URDF-style joint name into a sentence-case label (`left_elbow_joint` → `Left elbow`). */
function prettyJoint(name: string): string {
  const words = name.replace(/_joint$/, '').replace(/_/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * How often the keyboard console tells the agent it is alive, in ms (TASK-393).
 * Without a heartbeat a console may not drive a real robot's arms; a background
 * tab throttles this interval to ~1 Hz, which the agent's 1 s dead-man then
 * treats as the operator having gone — exactly right for a keyboard nobody is
 * looking at.
 */
const HEARTBEAT_MS = 100;

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="inline-flex min-w-6 items-center justify-center rounded-tag border border-line bg-inset px-1.5 py-0.5 font-mono text-xs text-ink-primary">
      {children}
    </kbd>
  );
}

// ============================================================================
// KEYBOARD TELEOP SECTION
// ============================================================================

/** How long the panel's Take control waits for the agent socket, then for the robot's `bound`. */
const TAKE_CONNECT_MS = 8_000;
const TAKE_BIND_MS = 8_000;

export function KeyboardTeleopSection({
  robot,
  onLeaseChange,
}: {
  robot: TeleopTabProps['robot'];
  /** This section's control lease, for the readiness panel's lease-gated steps (TASK-411). */
  onLeaseChange?: (lease: ReadinessLease) => void;
}) {
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [robotType, setRobotType] = useState('');
  const [joints, setJoints] = useState<TeleopJoint[]>([]);
  const [positions, setPositions] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState(0);
  const [activeDir, setActiveDir] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  /**
   * This console's clutch, as the agent is told it on every `{hb}`: a move key
   * held (TASK-393). A real robot's arms arm only on a rising edge of it, so a
   * key already held through an E-stop reset or a link drop does not re-arm.
   */
  const clutchRef = useRef(false);
  const beatRef = useRef(0);
  /** When each agent error code was last toasted (TASK-421). */
  const errorToastAtRef = useRef(new Map<string, number>());

  // Control lease (TASK-319). With the capability off this is inert and the
  // section drives exactly as before; with it on, motion needs `bound`.
  const lease = useControlLease(robot.id, {
    onMotionGate: () => {
      setActiveDir(0);
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ preset: 'stop' }));
    },
  });
  const leaseRef = useRef(lease);
  leaseRef.current = lease;
  const canDrive = !lease.enabled || lease.state === 'bound';
  const canDriveRef = useRef(canDrive);
  canDriveRef.current = canDrive;

  // Refs let the (stable) key handlers read the latest selection/joint list.
  const selectedRef = useRef(0);
  const jointsRef = useRef<TeleopJoint[]>([]);
  useEffect(() => { selectedRef.current = selected; }, [selected]);
  useEffect(() => { jointsRef.current = joints; }, [joints]);

  const connect = useCallback(() => {
    let opened = false;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    setConnecting(true);
    // Through the server's same-origin proxy (TASK-393), like the VR console.
    const ws = openTeleopSocket(robot);
    wsRef.current = ws;

    ws.onopen = () => {
      opened = true;
      clutchRef.current = false;
      heartbeat = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ hb: ++beatRef.current, clutch: clutchRef.current }));
        }
      }, HEARTBEAT_MS);
      const socket: LeaseSocket = {
        send: (payload) => {
          if (ws.readyState !== WebSocket.OPEN) return false;
          ws.send(JSON.stringify(payload));
          return true;
        },
        isOpen: () => ws.readyState === WebSocket.OPEN,
      };
      leaseRef.current.attachSocket(socket);
      setConnecting(false);
      setConnected(true);
      toast.success('Keyboard teleop connected', { description: robot.name });
    };
    ws.onclose = () => {
      if (heartbeat) clearInterval(heartbeat);
      if (wsRef.current === ws) leaseRef.current.attachSocket(null);
      setConnecting(false);
      setConnected(false);
      wsRef.current = null;
    };
    ws.onerror = () => {
      if (heartbeat) clearInterval(heartbeat);
      if (wsRef.current === ws) leaseRef.current.attachSocket(null);
      setConnecting(false);
      setConnected(false);
      wsRef.current = null;
      if (!opened) {
        toast.error("Couldn't connect keyboard teleop", {
          description: `${robot.name} did not answer. Start its robot agent and try again.`,
        });
      }
    };
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (leaseRef.current.handleSocketMessage(msg)) return;
        if (msg.type === 'config') {
          const list: TeleopJoint[] = msg.joints ?? [];
          setRobotType(msg.robotType ?? '');
          setJoints(list);
          setPositions(msg.positions ?? {});
          // Start on a joint that moves (TASK-421): a G1 lists its legs first,
          // and a leg is never driven on the real robot.
          setSelected(Math.max(0, list.findIndex((j) => isDrivable(j))));
        } else if (msg.type === 'drivable' && msg.joints && typeof msg.joints === 'object') {
          // What moves changed under this socket — the readiness panel switched
          // the sidecar to arm control after taking control (TASK-421 review).
          const flags = msg.joints as Record<string, unknown>;
          const list = jointsRef.current.map((j) =>
            typeof flags[j.name] === 'boolean' ? { ...j, drivable: flags[j.name] as boolean } : j);
          jointsRef.current = list;
          setJoints(list);
          // Leave the selection alone unless it now sits on a joint that never moves.
          if (!isDrivable(list[selectedRef.current])) {
            const first = list.findIndex((j) => isDrivable(j));
            selectedRef.current = Math.max(0, first);
            setSelected(selectedRef.current);
          }
        } else if (msg.type === 'state' && msg.positions) {
          setPositions(msg.positions);
        } else if (msg.type === 'error' && typeof msg.code === 'string') {
          // The agent says why a key moved nothing (TASK-421); one toast per
          // code at a time, not one per refused frame.
          const now = Date.now();
          if ((errorToastAtRef.current.get(msg.code) ?? -Infinity) + ERROR_TOAST_QUIET_MS <= now) {
            errorToastAtRef.current.set(msg.code, now);
            toast.error('Teleop command not applied', { description: String(msg.message ?? msg.code) });
          }
        }
      } catch { /* ignore parse errors */ }
    };
  }, [robot]);

  /**
   * Take control for the readiness panel (TASK-419 D3): connect this section's
   * agent socket when it is not open yet, then take the lease and wait until
   * the robot confirms it. Resolves true once bound. Opening the socket moves
   * nothing — the clutch stays open and no key is held.
   */
  const take = useCallback(async (): Promise<boolean> => {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const until = (ok: () => boolean, ms: number) =>
      new Promise<boolean>((resolve) => {
        const deadline = Date.now() + ms;
        const tick = () => {
          if (ok()) return resolve(true);
          if (Date.now() >= deadline) return resolve(false);
          setTimeout(tick, 100);
        };
        tick();
      });
    if (leaseRef.current.state === 'bound') return true;
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      if (!wsRef.current) connect();
      const ws = wsRef.current as WebSocket | null;
      if (!(await until(() => ws !== null && ws.readyState === WebSocket.OPEN && wsRef.current === ws, TAKE_CONNECT_MS))) return false;
      // The lease hook learns of the socket on open; give it one render to see it.
      await sleep(50);
    }
    await leaseRef.current.acquire();
    // Let the hook's own state (acquiring, or a refusal's notice) render first.
    await sleep(50);
    return until(
      () => leaseRef.current.state === 'bound' || (leaseRef.current.state === 'observing' && leaseRef.current.notice !== null),
      TAKE_BIND_MS,
    ).then(() => leaseRef.current.state === 'bound');
  }, [connect]);

  // The readiness panel sits outside this section; it reads the grant at
  // click time through the ref, never a stale copy.
  useEffect(() => {
    onLeaseChange?.({ enabled: lease.enabled, state: lease.state, grant: () => leaseRef.current.grant(), take });
  }, [lease.enabled, lease.state, onLeaseChange, take]);

  const disconnect = useCallback(() => {
    // Hand control back on purpose first, so the operator sees no "lost" banner.
    leaseRef.current.release();
    leaseRef.current.attachSocket(null);
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setConnected(false);
  }, []);

  const send = useCallback((payload: unknown) => {
    wsRef.current?.send(JSON.stringify(payload));
  }, []);

  // Keyboard handling: ↑/↓ pick a joint, ←/→ drive the selected joint while held.
  useEffect(() => {
    if (!connected) return;

    const moveSelection = (delta: number) => {
      setSelected((prev) => {
        const list = jointsRef.current;
        if (list.length === 0) return prev;
        return nextDrivable(list, prev, delta);
      });
    };

    const setClutch = (clutch: boolean) => {
      clutchRef.current = clutch;
      send({ hb: ++beatRef.current, clutch });
    };

    const driveSelected = (direction: 1 | -1 | 0) => {
      // Without the lease a press is ignored; a release (0) always goes out.
      if (direction !== 0 && !canDriveRef.current) return;
      const joint = jointsRef.current[selectedRef.current];
      if (!joint) return;
      setActiveDir(direction);
      // The clutch edge goes out at once and around the motion: closed BEFORE
      // the frame that arms, opened AFTER the frame that stops.
      const clutch = direction !== 0;
      if (clutch && !clutchRef.current) setClutch(true);
      send({ joint: joint.name, direction });
      if (!clutch && clutchRef.current) setClutch(false);
    };


    const isMoveKey = (k: string) =>
      k === 'ArrowRight' || k === 'ArrowLeft' || k === '+' || k === '=' || k === '-' || k === '_';

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const k = e.key;

      if (k === 'ArrowUp') { moveSelection(-1); e.preventDefault(); return; }
      if (k === 'ArrowDown') { moveSelection(1); e.preventDefault(); return; }
      if (k === 'h' || k === 'H') {
        if (canDriveRef.current) send({ preset: 'home' });
        e.preventDefault();
        return;
      }
      if (k === ' ') {
        send({ preset: 'stop' });
        setActiveDir(0);
        if (clutchRef.current) setClutch(false);
        e.preventDefault();
        return;
      }

      if (e.repeat) return; // begin motion once per physical key press
      if (k === 'ArrowRight' || k === '+' || k === '=') { driveSelected(1); e.preventDefault(); return; }
      if (k === 'ArrowLeft' || k === '-' || k === '_') { driveSelected(-1); e.preventDefault(); return; }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (isMoveKey(e.key)) { driveSelected(0); e.preventDefault(); }
    };

    // A key held while the window loses focus never gets its keyup (TASK-421):
    // the joint would keep moving until it hit its limit. Losing focus or
    // hiding the tab lets go of the key.
    const letGo = () => {
      if (clutchRef.current) driveSelected(0);
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') letGo();
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', letGo);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', letGo);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [connected, send]);

  // Cleanup on unmount
  useEffect(() => () => disconnect(), [disconnect]);

  const selectedJoint = joints[selected];

  return (
    <Panel>
      <Panel.Header
        title="Keyboard teleop"
        description={
          connected && robotType
            ? `${robotType.toUpperCase()} · ${joints.length} joints · simulation`
            : 'Drive single joints of the simulated robot from the keyboard.'
        }
        actions={
          <>
            <StatusTag tone={connected ? 'live' : 'neutral'} dot pulse={connected}>
              {connected ? 'Connected' : 'Not connected'}
            </StatusTag>
            {connected ? (
              <Button variant="ghost" size="sm" leftIcon={<Unplug className="h-4 w-4" strokeWidth={1.75} />} onClick={disconnect}>
                Disconnect
              </Button>
            ) : (
              <Button
                size="sm"
                leftIcon={<Plug className="h-4 w-4" strokeWidth={1.75} />}
                onClick={connect}
                isLoading={connecting}
                loadingText="Connecting…"
              >
                Connect
              </Button>
            )}
          </>
        }
      />
      <Panel.Body className="flex flex-col gap-4">
        {lease.enabled && (
          <ControlLeaseBar lease={lease} robotId={robot.id} robotName={robot.name} connected={connected} />
        )}
        <Panel variant="inset" padding="sm">
          <ul className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4" aria-label="Keyboard controls">
            {KEY_DISPLAY.map(({ keys, label }) => (
              <li key={label} className="flex items-center gap-2 text-[13px] text-ink-secondary">
                <span className="flex gap-1">
                  {keys.map((k) => <Kbd key={k}>{k}</Kbd>)}
                </span>
                {label}
              </li>
            ))}
          </ul>
        </Panel>

        {!connected ? (
          <EmptyState
            size="sm"
            icon={<Keyboard />}
            title="Not connected"
            description={`Connect to ${robot.name}'s robot agent to list its joints and drive them.`}
          />
        ) : (
          <>
            {selectedJoint && (
              <p className="text-[13px] text-ink-secondary">
                Selected <span className="font-medium text-ink-primary">{prettyJoint(selectedJoint.name)}</span>
                {activeDir !== 0 && (
                  <span className="ml-2 text-primary">{activeDir > 0 ? 'Moving +' : 'Moving −'}</span>
                )}
              </p>
            )}

            {/* Joint list — scrollable so it scales from SO-101 (6) to G1-EDU (43) */}
            <div className="grid max-h-80 grid-cols-1 gap-1.5 overflow-y-auto pr-1 md:grid-cols-2">
              {joints.map((joint, i) => {
                const pos = positions[joint.name] ?? joint.defaultPosition;
                const range = joint.limitUpper - joint.limitLower;
                const pct = range > 0 ? ((pos - joint.limitLower) / range) * 100 : 50;
                const isSel = i === selected;
                const drivable = isDrivable(joint);
                return (
                  <button
                    key={joint.name}
                    type="button"
                    onClick={() => drivable && setSelected(i)}
                    aria-pressed={isSel}
                    aria-disabled={!drivable}
                    title={drivable ? undefined : 'Not driven on this robot'}
                    className={cn(
                      'w-full rounded-control border px-3 py-2 text-left text-xs transition-colors',
                      isSel ? 'border-primary bg-primary/10' : 'border-line-subtle bg-inset hover:border-line-strong',
                      !drivable && 'cursor-not-allowed opacity-50 hover:border-line-subtle',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={isSel ? 'font-medium text-ink-primary' : 'text-ink-secondary'}>
                        {prettyJoint(joint.name)}
                        {!drivable && <span className="ml-1.5 text-ink-tertiary">· not driven</span>}
                      </span>
                      <span className="tabular-nums text-ink-primary">
                        {pos.toFixed(2)}
                        <span className="ml-0.5 text-ink-tertiary">rad</span>
                      </span>
                    </div>
                    <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-line-subtle">
                      <div className="h-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </Panel.Body>
    </Panel>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

// NOTE (TASK-117): the canonical record/leader-teleop surface is the data-collection
// page (`/data-collection/record/:sessionId`). This tab hosts only the live keyboard
// teleop, which drives the agent's simulated joint state directly, and VR teleop.

export function TeleopTab({ robot }: TeleopTabProps) {
  const [lease, setLease] = useState<ReadinessLease | null>(null);
  return (
    <div className="flex flex-col gap-6">
      <KeyboardTeleopSection robot={robot} onLeaseChange={setLease} />
      <RobotReadinessPanel robotId={robot.id} lease={lease} />
      <VRTeleopSection robot={robot} />
    </div>
  );
}

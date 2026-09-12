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

// ============================================================================
// TYPES & HELPERS
// ============================================================================

/** A teleoperable joint as advertised by the robot agent's teleop endpoint. */
interface TeleopJoint {
  name: string;
  limitLower: number;
  limitUpper: number;
  defaultPosition: number;
}

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

function getAgentBaseUrl(robot: TeleopTabProps['robot']): string {
  if (robot.a2aAgentUrl) {
    return robot.a2aAgentUrl.replace(/\/$/, '');
  }
  // 41243 is the robot agent's default port (robot-agent/src/config/config.ts).
  return 'http://localhost:41243';
}

function getWsBaseUrl(robot: TeleopTabProps['robot']): string {
  // Keyboard teleop WebSocket is served by the robot agent itself (same host/port
  // as the REST/A2A API), driving the simulated joint state.
  return getAgentBaseUrl(robot).replace(/^http/, 'ws');
}

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

export function KeyboardTeleopSection({ robot }: { robot: TeleopTabProps['robot'] }) {
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [robotType, setRobotType] = useState('');
  const [joints, setJoints] = useState<TeleopJoint[]>([]);
  const [positions, setPositions] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState(0);
  const [activeDir, setActiveDir] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  // Refs let the (stable) key handlers read the latest selection/joint list.
  const selectedRef = useRef(0);
  const jointsRef = useRef<TeleopJoint[]>([]);
  useEffect(() => { selectedRef.current = selected; }, [selected]);
  useEffect(() => { jointsRef.current = joints; }, [joints]);

  const connect = useCallback(() => {
    const wsUrl = `${getWsBaseUrl(robot)}/ws/keyboard-teleop`;
    let opened = false;
    setConnecting(true);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      opened = true;
      setConnecting(false);
      setConnected(true);
      toast.success('Keyboard teleop connected', { description: robot.name });
    };
    ws.onclose = () => {
      setConnecting(false);
      setConnected(false);
      wsRef.current = null;
    };
    ws.onerror = () => {
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
        if (msg.type === 'config') {
          setRobotType(msg.robotType ?? '');
          setJoints(msg.joints ?? []);
          setPositions(msg.positions ?? {});
          setSelected(0);
        } else if (msg.type === 'state' && msg.positions) {
          setPositions(msg.positions);
        }
      } catch { /* ignore parse errors */ }
    };
  }, [robot]);

  const disconnect = useCallback(() => {
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
        const len = jointsRef.current.length;
        if (len === 0) return prev;
        return Math.max(0, Math.min(len - 1, prev + delta));
      });
    };

    const driveSelected = (direction: 1 | -1 | 0) => {
      const joint = jointsRef.current[selectedRef.current];
      if (!joint) return;
      setActiveDir(direction);
      send({ joint: joint.name, direction });
    };

    const isMoveKey = (k: string) =>
      k === 'ArrowRight' || k === 'ArrowLeft' || k === '+' || k === '=' || k === '-' || k === '_';

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const k = e.key;

      if (k === 'ArrowUp') { moveSelection(-1); e.preventDefault(); return; }
      if (k === 'ArrowDown') { moveSelection(1); e.preventDefault(); return; }
      if (k === 'h' || k === 'H') { send({ preset: 'home' }); e.preventDefault(); return; }
      if (k === ' ') { send({ preset: 'stop' }); setActiveDir(0); e.preventDefault(); return; }

      if (e.repeat) return; // begin motion once per physical key press
      if (k === 'ArrowRight' || k === '+' || k === '=') { driveSelected(1); e.preventDefault(); return; }
      if (k === 'ArrowLeft' || k === '-' || k === '_') { driveSelected(-1); e.preventDefault(); return; }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (isMoveKey(e.key)) { driveSelected(0); e.preventDefault(); }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
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
                return (
                  <button
                    key={joint.name}
                    type="button"
                    onClick={() => setSelected(i)}
                    aria-pressed={isSel}
                    className={cn(
                      'w-full rounded-control border px-3 py-2 text-left text-xs transition-colors',
                      isSel ? 'border-primary bg-primary/10' : 'border-line-subtle bg-inset hover:border-line-strong',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={isSel ? 'font-medium text-ink-primary' : 'text-ink-secondary'}>
                        {prettyJoint(joint.name)}
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
  return (
    <div className="flex flex-col gap-6">
      <KeyboardTeleopSection robot={robot} />
      <VRTeleopSection robot={robot} />
    </div>
  );
}

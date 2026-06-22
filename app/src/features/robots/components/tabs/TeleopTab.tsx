/**
 * @file TeleopTab.tsx
 * @description Teleoperation tab with keyboard control, leader arm teleop, and dataset recording
 * @feature robots
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Card, Button } from '@/shared/components/ui';
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

/** Controls legend shown while connected (embodiment-agnostic). */
const KEY_DISPLAY: Array<{ keys: string; label: string }> = [
  { keys: '↑ / ↓', label: 'Select joint' },
  { keys: '← / →', label: 'Move joint' },
  { keys: 'H', label: 'Home' },
  { keys: 'Space', label: 'Stop' },
];

/** Turn a URDF-style joint name into a human label (e.g. `left_elbow_joint` → `Left Elbow`). */
function prettyJoint(name: string): string {
  return name
    .replace(/_joint$/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function getAgentBaseUrl(robot: TeleopTabProps['robot']): string {
  if (robot.a2aAgentUrl) {
    return robot.a2aAgentUrl.replace(/\/$/, '');
  }
  return 'http://localhost:41245';
}

function getWsBaseUrl(robot: TeleopTabProps['robot']): string {
  // Keyboard teleop WebSocket is served by the robot agent itself (same host/port
  // as the REST/A2A API), driving the simulated joint state.
  return getAgentBaseUrl(robot).replace(/^http/, 'ws');
}

// ============================================================================
// KEYBOARD TELEOP SECTION
// ============================================================================

export function KeyboardTeleopSection({ robot }: { robot: TeleopTabProps['robot'] }) {
  const [connected, setConnected] = useState(false);
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
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => { setConnected(false); wsRef.current = null; };
    ws.onerror = () => { setConnected(false); wsRef.current = null; };
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
    <Card className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-theme-primary">Keyboard Teleop</h3>
          {connected && robotType && (
            <p className="text-xs text-theme-secondary mt-0.5">
              {robotType.toUpperCase()} · {joints.length} DOF · simulation
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-block w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-gray-400'}`} />
          <span className="text-xs text-theme-secondary">{connected ? 'Connected' : 'Disconnected'}</span>
        </div>
      </div>

      {!connected ? (
        <Button variant="primary" size="sm" onClick={connect}>Connect</Button>
      ) : (
        <Button variant="ghost" size="sm" onClick={disconnect}>Disconnect</Button>
      )}

      {connected && (
        <>
          {/* Controls legend */}
          <div className="grid grid-cols-2 gap-2">
            {KEY_DISPLAY.map(({ keys, label }) => (
              <div
                key={keys}
                className="flex items-center justify-between px-3 py-2 rounded-lg border text-xs border-theme-subtle bg-theme-secondary text-theme-secondary"
              >
                <kbd className="font-mono font-medium">{keys}</kbd>
                <span>{label}</span>
              </div>
            ))}
          </div>

          {selectedJoint && (
            <div className="text-xs text-theme-secondary">
              Selected:{' '}
              <span className="text-theme-primary font-medium">{prettyJoint(selectedJoint.name)}</span>
              {activeDir !== 0 && (
                <span className="ml-2 text-cobalt-600 dark:text-cobalt-400">
                  {activeDir > 0 ? '▲ moving +' : '▼ moving −'}
                </span>
              )}
            </div>
          )}

          {/* Joint list — scrollable so it scales from SO-101 (6) to G1-EDU (43) */}
          <div className="space-y-1 max-h-72 overflow-y-auto pr-1">
            {joints.map((joint, i) => {
              const pos = positions[joint.name] ?? joint.defaultPosition;
              const range = joint.limitUpper - joint.limitLower;
              const pct = range > 0 ? ((pos - joint.limitLower) / range) * 100 : 50;
              const isSel = i === selected;
              return (
                <button
                  key={joint.name}
                  onClick={() => setSelected(i)}
                  className={`w-full text-left px-3 py-1.5 rounded-lg border text-xs transition-colors ${
                    isSel
                      ? 'border-cobalt-500 bg-cobalt-50 dark:bg-cobalt-900/30'
                      : 'border-theme-subtle bg-theme-secondary hover:border-cobalt-500/40'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className={isSel ? 'text-cobalt-600 dark:text-cobalt-400 font-medium' : 'text-theme-secondary'}>
                      {prettyJoint(joint.name)}
                    </span>
                    <span className="font-mono text-theme-primary">{pos.toFixed(2)} rad</span>
                  </div>
                  <div className="mt-1 h-1 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
                    <div
                      className="h-full bg-cobalt-500"
                      style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}
    </Card>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

// NOTE (TASK-117): the former `LeaderArmSection` and `RecordingSection` were
// removed here. They polled `${agent}/api/v1/teleop/{start,stop,status}`, which
// the robot-agent does not implement (every poll 404'd and flooded the console).
// The canonical record/leader-teleop surface is the data-collection page
// (`/data-collection/record/:sessionId`), driven server-side by
// `TeleoperationService` → sidecar `lerobot-record`. This tab now hosts only the
// live keyboard teleop, which drives the agent's simulated joint state directly.

export function TeleopTab({ robot }: TeleopTabProps) {
  return (
    <div className="space-y-6">
      <KeyboardTeleopSection robot={robot} />
      <VRTeleopSection robot={robot} />
    </div>
  );
}

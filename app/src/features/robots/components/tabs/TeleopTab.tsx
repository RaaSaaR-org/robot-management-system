/**
 * @file TeleopTab.tsx
 * @description Teleoperation tab with keyboard control, leader arm teleop, and dataset recording
 * @feature robots
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Card, Button } from '@/shared/components/ui';
import type { TeleopTabProps } from './types';

// ============================================================================
// CONSTANTS
// ============================================================================

const JOINT_NAMES = [
  'shoulder_pan', 'shoulder_lift', 'elbow_flex',
  'wrist_flex', 'wrist_roll', 'gripper',
] as const;

const JOINT_LABELS: Record<string, string> = {
  shoulder_pan: 'Shoulder Pan',
  shoulder_lift: 'Shoulder Lift',
  elbow_flex: 'Elbow Flex',
  wrist_flex: 'Wrist Flex',
  wrist_roll: 'Wrist Roll',
  gripper: 'Gripper',
};

/** Key bindings: key → { joint, delta } */
const KEY_BINDINGS: Record<string, { joint: string; delta: number }> = {
  w: { joint: 'shoulder_lift', delta: 10 },
  s: { joint: 'shoulder_lift', delta: -10 },
  a: { joint: 'shoulder_pan', delta: -10 },
  d: { joint: 'shoulder_pan', delta: 10 },
  q: { joint: 'elbow_flex', delta: 10 },
  e: { joint: 'elbow_flex', delta: -10 },
  z: { joint: 'wrist_flex', delta: 10 },
  x: { joint: 'wrist_flex', delta: -10 },
  ArrowUp: { joint: 'wrist_roll', delta: 10 },
  ArrowDown: { joint: 'wrist_roll', delta: -10 },
  o: { joint: 'gripper', delta: 15 },
  c: { joint: 'gripper', delta: -15 },
};

const KEY_DISPLAY: Array<{ keys: string; label: string }> = [
  { keys: 'W / S', label: 'Shoulder Lift' },
  { keys: 'A / D', label: 'Shoulder Pan' },
  { keys: 'Q / E', label: 'Elbow Flex' },
  { keys: 'Z / X', label: 'Wrist Flex' },
  { keys: 'Up / Down', label: 'Wrist Roll' },
  { keys: 'O / C', label: 'Gripper' },
  { keys: 'H', label: 'Home' },
  { keys: 'Space', label: 'Stop' },
];

// ============================================================================
// HELPERS
// ============================================================================

function getAgentBaseUrl(robot: TeleopTabProps['robot']): string {
  if (robot.a2aAgentUrl) {
    return robot.a2aAgentUrl.replace(/\/$/, '');
  }
  return 'http://localhost:41245';
}

function getWsBaseUrl(robot: TeleopTabProps['robot']): string {
  // Keyboard teleop WebSocket runs on the sidecar (port 8766), not the agent
  const base = getAgentBaseUrl(robot);
  try {
    const url = new URL(base);
    return `ws://${url.hostname}:8766`;
  } catch {
    return base.replace(/^http/, 'ws');
  }
}

// ============================================================================
// KEYBOARD TELEOP SECTION
// ============================================================================

export function KeyboardTeleopSection({ robot }: { robot: TeleopTabProps['robot'] }) {
  const [connected, setConnected] = useState(false);
  const [positions, setPositions] = useState<Record<string, number>>({});
  const [activeKeys, setActiveKeys] = useState<Set<string>>(new Set());
  const wsRef = useRef<WebSocket | null>(null);

  const connect = useCallback(() => {
    const wsUrl = `${getWsBaseUrl(robot)}/ws/keyboard-teleop`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;
    };
    ws.onerror = () => {
      setConnected(false);
      wsRef.current = null;
    };
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'state' && msg.positions) {
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

  // Keyboard event handler
  useEffect(() => {
    if (!connected) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      const key = e.key;
      setActiveKeys(prev => new Set(prev).add(key.toLowerCase()));

      if (key === 'h' || key === 'H') {
        wsRef.current?.send(JSON.stringify({ preset: 'home' }));
        e.preventDefault();
        return;
      }
      if (key === ' ') {
        wsRef.current?.send(JSON.stringify({ preset: 'stop' }));
        e.preventDefault();
        return;
      }

      const binding = KEY_BINDINGS[key] || KEY_BINDINGS[key.toLowerCase()];
      if (binding) {
        wsRef.current?.send(JSON.stringify({ joint: binding.joint, delta: binding.delta }));
        e.preventDefault();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      setActiveKeys(prev => {
        const next = new Set(prev);
        next.delete(e.key.toLowerCase());
        return next;
      });
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [connected]);

  // Cleanup on unmount
  useEffect(() => () => disconnect(), [disconnect]);

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-theme-primary">Keyboard Teleop</h3>
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
          {/* Key bindings grid */}
          <div className="grid grid-cols-2 gap-2">
            {KEY_DISPLAY.map(({ keys, label }) => {
              const isActive = keys.toLowerCase().split(' / ').some(k =>
                activeKeys.has(k.trim().toLowerCase())
              );
              return (
                <div
                  key={keys}
                  className={`flex items-center justify-between px-3 py-2 rounded-lg border text-xs ${
                    isActive
                      ? 'border-cobalt-500 bg-cobalt-50 dark:bg-cobalt-900/30 text-cobalt-600 dark:text-cobalt-400'
                      : 'border-theme-subtle bg-theme-secondary text-theme-secondary'
                  }`}
                >
                  <kbd className="font-mono font-medium">{keys}</kbd>
                  <span>{label}</span>
                </div>
              );
            })}
          </div>

          {/* Joint positions */}
          <div className="space-y-2">
            <h4 className="text-xs font-medium text-theme-secondary">Joint Positions</h4>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              {JOINT_NAMES.map(name => (
                <div key={name} className="flex items-center justify-between text-xs">
                  <span className="text-theme-secondary">{JOINT_LABELS[name]}</span>
                  <span className="font-mono text-theme-primary">
                    {(positions[name] ?? 0).toFixed(1)}°
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </Card>
  );
}

// ============================================================================
// LEADER ARM SECTION
// ============================================================================

function LeaderArmSection({ robot }: { robot: TeleopTabProps['robot'] }) {
  const [leaderPort, setLeaderPort] = useState('/dev/ttyACM1');
  const [active, setActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const baseUrl = getAgentBaseUrl(robot);

  const pollStatus = useCallback(async () => {
    try {
      const res = await fetch(`${baseUrl}/api/v1/teleop/status`);
      const data = await res.json();
      setActive(data.active && data.mode === 'leader');
    } catch { /* ignore */ }
  }, [baseUrl]);

  useEffect(() => {
    pollStatus();
    const interval = setInterval(pollStatus, 3000);
    return () => clearInterval(interval);
  }, [pollStatus]);

  const start = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${baseUrl}/api/v1/teleop/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leaderPort }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to start');
      setActive(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start leader teleop');
    } finally {
      setLoading(false);
    }
  };

  const stop = async () => {
    setLoading(true);
    setError('');
    try {
      await fetch(`${baseUrl}/api/v1/teleop/stop`, { method: 'POST' });
      setActive(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stop');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-theme-primary">Leader Arm Teleop</h3>
        <div className="flex items-center gap-2">
          <span className={`inline-block w-2 h-2 rounded-full ${active ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
          <span className="text-xs text-theme-secondary">{active ? 'Active' : 'Inactive'}</span>
        </div>
      </div>

      <div className="space-y-2">
        <label className="block text-xs text-theme-secondary">Leader Port</label>
        <input
          type="text"
          value={leaderPort}
          onChange={e => setLeaderPort(e.target.value)}
          disabled={active}
          className="w-full px-3 py-1.5 text-sm rounded-lg border border-theme-subtle bg-theme-primary text-theme-primary focus:outline-none focus:ring-2 focus:ring-cobalt-500 disabled:opacity-50"
          placeholder="/dev/ttyACM1"
        />
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}

      {!active ? (
        <Button variant="primary" size="sm" onClick={start} disabled={loading}>
          {loading ? 'Starting...' : 'Start Leader Teleop'}
        </Button>
      ) : (
        <Button variant="ghost" size="sm" onClick={stop} disabled={loading}>
          {loading ? 'Stopping...' : 'Stop'}
        </Button>
      )}
    </Card>
  );
}

// ============================================================================
// RECORDING SECTION
// ============================================================================

function RecordingSection({ robot }: { robot: TeleopTabProps['robot'] }) {
  const [datasetRepoId, setDatasetRepoId] = useState('RaaSaaR-org/so101-demo');
  const [task, setTask] = useState('pick up the cup');
  const [numEpisodes, setNumEpisodes] = useState(10);
  const [leaderPort, setLeaderPort] = useState('/dev/ttyACM1');
  const [recording, setRecording] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const baseUrl = getAgentBaseUrl(robot);

  const pollStatus = useCallback(async () => {
    try {
      const res = await fetch(`${baseUrl}/api/v1/teleop/status`);
      const data = await res.json();
      setRecording(data.active && data.recording);
    } catch { /* ignore */ }
  }, [baseUrl]);

  useEffect(() => {
    pollStatus();
    const interval = setInterval(pollStatus, 3000);
    return () => clearInterval(interval);
  }, [pollStatus]);

  const start = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${baseUrl}/api/v1/teleop/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leaderPort,
          record: true,
          datasetRepoId,
          task,
          numEpisodes,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to start recording');
      setRecording(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start recording');
    } finally {
      setLoading(false);
    }
  };

  const stop = async () => {
    setLoading(true);
    setError('');
    try {
      await fetch(`${baseUrl}/api/v1/teleop/stop`, { method: 'POST' });
      setRecording(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stop recording');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-theme-primary">Dataset Recording</h3>
        <div className="flex items-center gap-2">
          {recording && <span className="inline-block w-2 h-2 rounded-full bg-red-500 animate-pulse" />}
          <span className="text-xs text-theme-secondary">{recording ? 'Recording' : 'Idle'}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3">
        <div>
          <label className="block text-xs text-theme-secondary mb-1">Leader Port</label>
          <input
            type="text"
            value={leaderPort}
            onChange={e => setLeaderPort(e.target.value)}
            disabled={recording}
            className="w-full px-3 py-1.5 text-sm rounded-lg border border-theme-subtle bg-theme-primary text-theme-primary focus:outline-none focus:ring-2 focus:ring-cobalt-500 disabled:opacity-50"
          />
        </div>
        <div>
          <label className="block text-xs text-theme-secondary mb-1">Dataset Repo ID</label>
          <input
            type="text"
            value={datasetRepoId}
            onChange={e => setDatasetRepoId(e.target.value)}
            disabled={recording}
            className="w-full px-3 py-1.5 text-sm rounded-lg border border-theme-subtle bg-theme-primary text-theme-primary focus:outline-none focus:ring-2 focus:ring-cobalt-500 disabled:opacity-50"
          />
        </div>
        <div>
          <label className="block text-xs text-theme-secondary mb-1">Task Description</label>
          <input
            type="text"
            value={task}
            onChange={e => setTask(e.target.value)}
            disabled={recording}
            className="w-full px-3 py-1.5 text-sm rounded-lg border border-theme-subtle bg-theme-primary text-theme-primary focus:outline-none focus:ring-2 focus:ring-cobalt-500 disabled:opacity-50"
          />
        </div>
        <div>
          <label className="block text-xs text-theme-secondary mb-1">Num Episodes</label>
          <input
            type="number"
            value={numEpisodes}
            onChange={e => setNumEpisodes(parseInt(e.target.value) || 1)}
            disabled={recording}
            min={1}
            className="w-full px-3 py-1.5 text-sm rounded-lg border border-theme-subtle bg-theme-primary text-theme-primary focus:outline-none focus:ring-2 focus:ring-cobalt-500 disabled:opacity-50"
          />
        </div>
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}

      {!recording ? (
        <Button variant="primary" size="sm" onClick={start} disabled={loading}>
          {loading ? 'Starting...' : 'Start Recording'}
        </Button>
      ) : (
        <Button variant="ghost" size="sm" onClick={stop} disabled={loading}>
          {loading ? 'Stopping...' : 'Stop Recording'}
        </Button>
      )}
    </Card>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function TeleopTab({ robot }: TeleopTabProps) {
  return (
    <div className="space-y-6">
      <KeyboardTeleopSection robot={robot} />
      <LeaderArmSection robot={robot} />
      <RecordingSection robot={robot} />
    </div>
  );
}

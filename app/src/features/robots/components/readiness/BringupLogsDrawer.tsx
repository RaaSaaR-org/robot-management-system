/**
 * @file BringupLogsDrawer.tsx
 * @description The robot side's process logs (TASK-411): one tab per process
 *              (bridge / sidecar / agent, plus the simulator on a sim profile),
 *              the last 200 lines, then the live SSE stream appended with
 *              auto-scroll and a pause toggle. Opening the drawer is the only
 *              thing that reads a log — no terminal on robot day.
 * @feature robots
 */

import { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { Button } from '@/shared/components/ui/Button';
import { cn } from '@/shared/utils/cn';
import { readinessApi, type BringupProc, type ReadinessApi } from '../../api/readinessApi';

/** Lines kept in memory per tab. */
export const LOG_LINES_MAX = 2000;
const TAIL = 200;

export interface BringupLogsDrawerProps {
  robotId: string;
  /** The processes to offer, in tab order. */
  procs?: BringupProc[];
  api?: Pick<ReadinessApi, 'getBringupLogs' | 'streamBringupLogs'>;
  onClose?: () => void;
}

const PROC_LABEL: Record<BringupProc, string> = {
  sim: 'simulator',
  bridge: 'bridge',
  sidecar: 'sidecar',
  agent: 'agent',
};

export function BringupLogsDrawer({
  robotId,
  procs = ['bridge', 'sidecar', 'agent'],
  api = readinessApi,
  onClose,
}: BringupLogsDrawerProps) {
  const [proc, setProc] = useState<BringupProc>(procs[0] ?? 'sidecar');
  const [lines, setLines] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  pausedRef.current = paused;
  const bufferRef = useRef<string[]>([]);
  const boxRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | null = null;
    setLines([]);
    setError(null);
    bufferRef.current = [];
    void (async () => {
      let tail: string[] = [];
      try {
        tail = await api.getBringupLogs(robotId, proc, TAIL);
      } catch (err) {
        if (!disposed) setError(err instanceof Error ? err.message : String(err));
      }
      if (disposed) return;
      setLines(tail.slice(-LOG_LINES_MAX));
      // The stream replays its own last lines first: skip the ones the tail
      // already shows, then append everything new.
      let replay = tail.slice(-50);
      stop = api.streamBringupLogs(
        robotId,
        proc,
        (line) => {
          if (disposed) return;
          if (replay.length > 0) {
            const at = replay.indexOf(line);
            if (at >= 0) {
              replay = replay.slice(at + 1);
              return;
            }
            replay = [];
          }
          if (pausedRef.current) {
            bufferRef.current.push(line);
            return;
          }
          setLines((cur) => [...cur, line].slice(-LOG_LINES_MAX));
        },
        (msg) => {
          if (!disposed) setError(msg);
        },
      );
    })();
    return () => {
      disposed = true;
      stop?.();
    };
  }, [api, robotId, proc]);

  // Resuming flushes what arrived while paused.
  useEffect(() => {
    if (paused || bufferRef.current.length === 0) return;
    const held = bufferRef.current;
    bufferRef.current = [];
    setLines((cur) => [...cur, ...held].slice(-LOG_LINES_MAX));
  }, [paused]);

  // Auto-scroll while following.
  useEffect(() => {
    if (paused) return;
    const box = boxRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [lines, paused]);

  return (
    <section className="rounded-control border border-line-subtle bg-inset" data-testid="bringup-logs" aria-label="Robot side logs">
      <div className="flex flex-wrap items-center gap-2 border-b border-line-subtle px-3 py-2">
        <div role="tablist" aria-label="Process" className="flex gap-1">
          {procs.map((p) => (
            <button
              key={p}
              type="button"
              role="tab"
              aria-selected={p === proc}
              onClick={() => setProc(p)}
              className={cn(
                'rounded-control px-2.5 py-1 text-[12px] font-medium',
                p === proc ? 'bg-primary/10 text-primary' : 'text-ink-secondary hover:text-ink-primary',
              )}
            >
              {PROC_LABEL[p]}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            leftIcon={paused ? <Play className="h-4 w-4" strokeWidth={1.75} /> : <Pause className="h-4 w-4" strokeWidth={1.75} />}
            onClick={() => setPaused((v) => !v)}
            aria-pressed={paused}
          >
            {paused ? 'Resume' : 'Pause'}
          </Button>
          {onClose && (
            <Button size="sm" variant="ghost" onClick={onClose}>
              Close
            </Button>
          )}
        </div>
      </div>
      {error && <p className="px-3 pt-2 text-[12px] text-signal-stopped">{error}</p>}
      <pre
        ref={boxRef}
        data-testid="bringup-logs-lines"
        className="max-h-72 overflow-auto whitespace-pre-wrap break-all px-3 py-2 font-mono text-[11px] leading-relaxed text-ink-secondary"
      >
        {lines.length === 0 ? 'No log lines yet.' : lines.join('\n')}
      </pre>
    </section>
  );
}

/**
 * @file BeliefReadout.tsx
 * @description Hero signature — the robot's belief state as a live instrument,
 *              replaying the verified warehouse geofence run.
 * @feature landing
 *
 * This is the page's one bold element, and it replays a single documented run:
 * TASK-200, 2026-08-02, warehouse hall. A `walk forward 2 metres` aimed at
 * keepout RACK-A was stopped at x=3.52 — 0.48 m clear of the rack face — with
 * the plan aborted through onSafetyStop and the next command refused while the
 * latch held. A second approach reproduced it at (3.51, -1.99), i.e. 0.49 m.
 *
 * Everything rendered here is shaped like what the platform actually emits:
 *   - the command is the one from the task record, not a nicer-sounding one
 *   - `walk` is a real block kind (robot-agent/src/agent-mode/types.ts)
 *   - place confidence is `confident` / `stale` — the platform has never
 *     produced a numeric confidence, so no float is shown
 *   - clearance starts UNKNOWN because a cone with no return is UNKNOWN, never
 *     "clear" (robot-agent/src/agent-mode/range.ts)
 *   - the halt line is the SafetyMonitor's own string
 *
 * The readout ends on a refusal rather than a success. That is the point.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type BlockState = 'pending' | 'running' | 'done' | 'aborted';
type Provenance = 'measured' | 'unknown' | 'stopped';

interface Step {
  /** ms from sequence start */
  at: number;
  apply: (draft: Frame) => void;
}

interface BlockRow {
  kind: string;
  arg: string;
  state: BlockState;
}

interface Frame {
  typed: string;
  planned: boolean;
  blocks: BlockRow[];
  place: string;
  confidence: string;
  clearance: string;
  clearanceSource: Provenance;
  halted: boolean;
}

const COMMAND = 'walk forward 2 metres';
const HALT_LINE =
  'PROTECTIVE STOP: Keepout violated: Rack A (RACK-A) — 0.02 m past the safety margin at (3.52, −2.50)';

const INITIAL: Frame = {
  typed: '',
  planned: false,
  blocks: [],
  place: 'AISLE-1',
  confidence: 'confident',
  clearance: 'UNKNOWN',
  clearanceSource: 'unknown',
  halted: false,
};

/** Terminal state — also what a reduced-motion visitor sees immediately. */
const FINAL: Frame = {
  typed: COMMAND,
  planned: true,
  blocks: [{ kind: 'walk', arg: 'forward 2.00 m', state: 'aborted' }],
  place: 'AISLE-1',
  confidence: 'confident',
  clearance: '0.48 m',
  clearanceSource: 'stopped',
  halted: true,
};

function buildSequence(): Step[] {
  const steps: Step[] = [];

  for (let i = 1; i <= COMMAND.length; i += 1) {
    steps.push({
      at: 400 + i * 45,
      apply: (d) => {
        d.typed = COMMAND.slice(0, i);
      },
    });
  }

  const typed = 400 + COMMAND.length * 45;

  steps.push({
    at: typed + 520,
    apply: (d) => {
      d.planned = true;
      d.blocks = [{ kind: 'walk', arg: 'forward 2.00 m', state: 'running' }];
    },
  });

  // First cone query returns: UNKNOWN resolves to a measurement.
  steps.push({
    at: typed + 1240,
    apply: (d) => {
      d.clearance = '0.69 m';
      d.clearanceSource = 'measured';
    },
  });

  ['0.63 m', '0.57 m', '0.52 m'].forEach((value, i) => {
    steps.push({
      at: typed + 1700 + i * 420,
      apply: (d) => {
        d.clearance = value;
      },
    });
  });

  // The climax: the fence stops the plan. It does not complete.
  steps.push({
    at: typed + 3180,
    apply: (d) => {
      d.clearance = '0.48 m';
      d.clearanceSource = 'stopped';
      d.blocks[0] = { ...d.blocks[0], state: 'aborted' };
      d.halted = true;
    },
  });

  return steps;
}

const SEQUENCE = buildSequence();
const RUNTIME = SEQUENCE[SEQUENCE.length - 1].at + 2400;

function blockGlyph(state: BlockState): string {
  if (state === 'aborted') return '×';
  if (state === 'running') return '›';
  if (state === 'done') return '·';
  return '⋯';
}

function blockColor(state: BlockState): string {
  if (state === 'aborted') return 'var(--color-signal-stopped)';
  if (state === 'running') return 'var(--text-primary)';
  return 'var(--text-secondary)';
}

function provenanceColor(source: Provenance): string {
  if (source === 'measured') return 'var(--color-signal-measured)';
  if (source === 'unknown') return 'var(--color-signal-unknown)';
  return 'var(--color-signal-stopped)';
}

export function BeliefReadout() {
  const prefersReduced = useMemo(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  );

  const [frame, setFrame] = useState<Frame>(prefersReduced ? FINAL : INITIAL);
  const [runId, setRunId] = useState(0);
  const rafRef = useRef<number | null>(null);

  const replay = useCallback(() => {
    setFrame(INITIAL);
    setRunId((n) => n + 1);
  }, []);

  useEffect(() => {
    if (prefersReduced) {
      setFrame(FINAL);
      return;
    }

    const start = performance.now();
    let cursor = 0;
    const draft: Frame = { ...INITIAL, blocks: [] };

    const tick = (now: number) => {
      const elapsed = now - start;
      let changed = false;

      while (cursor < SEQUENCE.length && SEQUENCE[cursor].at <= elapsed) {
        SEQUENCE[cursor].apply(draft);
        cursor += 1;
        changed = true;
      }

      if (changed) {
        setFrame({ ...draft, blocks: draft.blocks.map((b) => ({ ...b })) });
      }

      if (elapsed < RUNTIME) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [runId, prefersReduced]);

  return (
    <section className="lp-panel overflow-hidden" aria-label="Agent Mode plan readout">
      {/* Instrument header — who is answering, and how honest the answer is. */}
      <div
        className="flex items-center justify-between gap-3 border-b px-4 py-2.5"
        style={{ borderColor: 'var(--border-color)' }}
      >
        <span className="lp-key truncate">Nova · Unitree G1 EDU · Dex3-1</span>
        <span className="lp-tag lp-tag-sim shrink-0">Sim</span>
      </div>

      {/* Command line */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-baseline gap-2">
          <span className="lp-key shrink-0" aria-hidden="true">
            &gt;
          </span>
          <p className="lp-value break-words" style={{ fontSize: '0.875rem' }}>
            {frame.typed}
            {!frame.planned && !prefersReduced && (
              <span
                className="ml-0.5 inline-block h-[1.05em] w-[0.5em] translate-y-[0.12em]"
                style={{ backgroundColor: 'var(--text-tertiary)' }}
                aria-hidden="true"
              />
            )}
          </p>
        </div>
      </div>

      {/* Block plan — the typed, auditable thing the local model produced */}
      <div className="border-t px-4 py-3" style={{ borderColor: 'var(--border-color)' }}>
        <div className="lp-key mb-2.5">{frame.planned ? 'Plan · 1 block' : 'Planning…'}</div>
        <ul className="min-h-[1.5rem] space-y-1.5" role="list">
          {frame.blocks.map((block, i) => (
            <li
              key={`${block.kind}-${i}`}
              className="flex items-baseline gap-3 text-[0.8125rem]"
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              <span
                className="w-[0.9rem] shrink-0 text-center"
                style={{ color: blockColor(block.state) }}
                aria-hidden="true"
              >
                {blockGlyph(block.state)}
              </span>
              <span className="shrink-0" style={{ color: 'var(--text-primary)' }}>
                {block.kind}
              </span>
              <span className="min-w-0 flex-1 truncate" style={{ color: 'var(--text-secondary)' }}>
                {block.arg}
              </span>
              {block.state === 'aborted' && (
                <span
                  className="shrink-0"
                  style={{ color: 'var(--color-signal-stopped)' }}
                >
                  aborted
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>

      {/* Belief strip — where it thinks it is, and how much room is left */}
      <div
        className="grid grid-cols-2 border-t sm:grid-cols-3"
        style={{ borderColor: 'var(--border-color)' }}
      >
        <div className="px-4 py-3">
          <div className="lp-key mb-1">Place</div>
          <div className="lp-value">{frame.place}</div>
        </div>
        <div className="border-l px-4 py-3" style={{ borderColor: 'var(--border-color)' }}>
          <div className="lp-key mb-1">Pose</div>
          <div className="lp-value">{frame.confidence}</div>
        </div>
        <div
          className="col-span-2 border-t px-4 py-3 sm:col-span-1 sm:border-t-0 sm:border-l"
          style={{ borderColor: 'var(--border-color)' }}
        >
          <div className="lp-key mb-1">Clearance</div>
          <div className="lp-value" style={{ color: provenanceColor(frame.clearanceSource) }}>
            {frame.clearance}
          </div>
        </div>
      </div>

      {/* The climax: a refusal, in the safety monitor's own words. */}
      <div
        className="border-t px-4 py-3"
        style={{
          borderColor: 'var(--border-color)',
          backgroundColor: frame.halted
            ? 'color-mix(in srgb, var(--color-signal-stopped) 10%, transparent)'
            : undefined,
        }}
        role="status"
        aria-live="polite"
      >
        {frame.halted ? (
          <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
            <span className="lp-tag lp-tag-stopped mt-0.5">Stopped</span>
            <span
              className="min-w-0 flex-1 text-[0.75rem] leading-relaxed"
              style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}
            >
              {HALT_LINE}
            </span>
          </div>
        ) : (
          <span className="lp-key">Executing on the robot…</span>
        )}
      </div>

      {frame.halted && !prefersReduced && (
        <div className="border-t px-4 py-1.5" style={{ borderColor: 'var(--border-color)' }}>
          <button
            type="button"
            onClick={replay}
            className="lp-key -mx-2 inline-flex min-h-[2rem] items-center rounded px-2 transition-colors hover:underline focus:outline-none focus-visible:ring-2"
          >
            Replay ↻
          </button>
        </div>
      )}
    </section>
  );
}

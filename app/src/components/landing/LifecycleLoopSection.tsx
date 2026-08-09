/**
 * @file LifecycleLoopSection.tsx
 * @description The six-stage lifecycle, drawn as a lemniscate, with a per-stage
 *              maturity tag because the stages are not equally mature.
 * @feature landing
 *
 * The figure-8 geometry is deliberate and is preserved verbatim: four cubic
 * Béziers form two teardrop loops that cross at the origin, and that crossing
 * is the Deploy → Evaluate handoff. Everything else — colour, motion, mobile
 * layout — was rebuilt so the graphic works in both themes, states only claims
 * the code backs up, and never renders a 12px touch target.
 */

import { useState } from 'react';

type Tone = 'dev' | 'ops';
type Maturity = 'live' | 'sim' | 'gated';
type LabelAnchor = 'start' | 'middle' | 'end';

interface Stage {
  key: string;
  /** 1-based position in the loop; rendered inside the node disc. */
  index: number;
  label: string;
  maturity: Maturity;
  /** Which half of the lemniscate the node sits on (matches the gradient split). */
  tone: Tone;
  /** Node center in SVG user units */
  x: number;
  y: number;
  /** Where the label sits relative to the node */
  labelX: number;
  labelY: number;
  labelAnchor: LabelAnchor;
  summary: string;
  bullets: string[];
}

// True figure-8 geometry. The curve is a lemniscate traced with 4 cubic Béziers that
// cross each other at the origin — that crossing is the dev→ops handoff.
// Control points at y=±80 make the curve peak at y=±60, x=±102.5 (Bezier math),
// so each node sits exactly on the top/bottom of its loop.
const STAGES: Stage[] = [
  {
    key: 'collect',
    index: 1,
    label: 'Collect',
    maturity: 'live',
    tone: 'dev',
    x: -102.5,
    y: -60,
    labelX: 0,
    labelY: -42,
    labelAnchor: 'middle',
    summary: 'Demonstrations, teleop sessions and real LiDAR scans become versioned datasets.',
    bullets: [
      'Curation trims or deletes episodes video-aware and returns a new revision with lineage — the source dataset is never modified.',
      'Upload a PLY or PCD and a sidecar builds a Digital Twin plus a usable MuJoCo scene, validated on a 240k-point MID-360 capture of the lab.',
      'VR and teleop sessions record into a true LeRobot v3.0 chunked dataset — in simulation so far.',
    ],
  },
  {
    key: 'train',
    index: 2,
    label: 'Train',
    maturity: 'live',
    tone: 'dev',
    x: -160,
    y: 0,
    labelX: -44,
    labelY: 2,
    labelAnchor: 'end',
    summary: 'Fine-tune on your own data without leaving the LeRobot format.',
    bullets: [
      'LeRobot-compatible in both v2.1 and v3.0, with HuggingFace Hub sync in both directions.',
      'SmolVLA is active, GR00T N1.7 is ready, pi0.5 is a stub.',
      'Training runs in a separate worker that polls /api/training/workers/claim; serving runs in the VLA server.',
    ],
  },
  {
    key: 'deploy',
    index: 3,
    // Gated, not Live: the registry, canary and rollback paths are real, but the
    // only bridge to a real G1 refuses to move unless it is explicitly armed, so
    // no model has ever been shipped to physical hardware. See the third bullet.
    label: 'Deploy',
    maturity: 'gated',
    tone: 'dev',
    x: -102.5,
    y: 60,
    labelX: 0,
    labelY: 42,
    labelAnchor: 'middle',
    summary: 'Ship a model to a robot the way you would ship software.',
    bullets: [
      'Model registry, canary rollouts with per-stage health checks, one-click rollback.',
      'OTA packages signed with Ed25519.',
      'The real-G1 GR00T bridge is gated: dry-run by default, needs both G1_BRIDGE_ARMED=1 and --arm, and never commands the legs.',
    ],
  },
  {
    key: 'evaluate',
    index: 4,
    label: 'Evaluate',
    maturity: 'sim',
    tone: 'ops',
    x: 102.5,
    y: 60,
    labelX: 0,
    labelY: 42,
    labelAnchor: 'middle',
    summary: 'Score a policy in MuJoCo, and try to catch yourself being optimistic.',
    bullets: [
      'Sim jobs with per-episode reward scoring, success rate, error breakdown and model comparison.',
      'A null control that must score zero and an off-instruction proxy that auto-refuses when it matches on-instruction, n=40 per cell — the first run overturned an earlier optimistic result.',
      'A G1 + Dex3 pick-and-place environment replicates NVIDIA’s GR00T-N1.7-AppleToPlate workflow.',
    ],
  },
  {
    key: 'operate',
    index: 5,
    label: 'Operate',
    maturity: 'sim',
    tone: 'ops',
    x: 160,
    y: 0,
    labelX: 44,
    labelY: 2,
    labelAnchor: 'start',
    summary: 'A local model plans; the safety layer decides whether the plan gets to run.',
    bullets: [
      'Agent Mode turns “geh zum Regal RACK-A” into a typed block plan run over the Unitree LocoClient — the same call path as a real G1.',
      'An enforced geofence stopped a 2 m walk 0.48 m clear of rack RACK-A and refused the next command while latched. Reproduced twice.',
      'The read-only telemetry path is live-verified against a powered G1; everything that moves the robot is still simulation.',
    ],
  },
  {
    key: 'comply',
    index: 6,
    label: 'Comply',
    maturity: 'live',
    tone: 'ops',
    x: 102.5,
    y: -60,
    labelX: 0,
    labelY: -42,
    labelAnchor: 'middle',
    summary: 'Record-keeping a regulator can check, and erasure that reaches the robot.',
    bullets: [
      'Hash-chained, tamper-evident audit logs with a verify endpoint (EU AI Act Art. 12).',
      'GDPR Art. 30 records of processing, a self-service portal for seven request types, legal holds and retention policies.',
      'Art. 17 erasure wipes the on-robot memory workspace on every reachable robot and reports honestly about the ones that were switched off.',
    ],
  },
];

// True lemniscate / figure-8. Four cubic Béziers form two teardrop loops that cross
// at (0, 0). At the crossing the curve passes through twice with tangents (60, 80)
// and (-60, 80) — a visible X, exactly like the DevOps ∞.
const INFINITY_PATH = [
  'M -160 0',
  'C -160 -80, -60 -80, 0 0',
  'C 60 80, 160 80, 160 0',
  'C 160 -80, 60 -80, 0 0',
  'C -60 80, -160 80, -160 0',
  'Z',
].join(' ');

/**
 * Colour for the small marks that carry meaning — node rings, bullet dashes,
 * stepper indices.
 *
 * These deliberately do NOT use --color-primary / --color-accent. Those are
 * white-labellable brand tokens with no contrast floor: measured against the
 * light theme they returned 1.64:1 for the ops dashes and 2.58:1 for the dev
 * dashes (1.43:1 under the shipped cobalt), where small text needs 4.5:1 and a
 * graphic needs 3:1. --text-primary and the fixed signal teal are calibrated
 * per theme, so the marks stay legible whatever the brand is set to.
 *
 * dev is ink and ops is teal rather than the neutral --color-signal-estimated,
 * because that token is now an alias of --text-secondary and is what the Sim
 * tag renders in — reusing it on the nodes would have made the ring colour
 * read as maturity instead of as which half of the loop the stage sits on.
 * The lemniscate stroke itself keeps the brand gradient: it is a 4px-wide
 * decorative flourish, not something anyone has to read.
 */
function toneColor(tone: Tone): string {
  return tone === 'dev' ? 'var(--text-primary)' : 'var(--color-signal-measured)';
}

function tagClass(maturity: Maturity): string {
  if (maturity === 'live') return 'lp-tag lp-tag-live';
  if (maturity === 'gated') return 'lp-tag lp-tag-gated';
  return 'lp-tag lp-tag-sim';
}

function tagLabel(maturity: Maturity): string {
  if (maturity === 'live') return 'Live';
  if (maturity === 'gated') return 'Gated';
  return 'Sim';
}

/**
 * The readout panel always exists, so the nodes can point aria-controls at it
 * and the swap can be announced. Before this, changing stage changed the panel
 * silently and nothing tied the two together.
 */
const READOUT_ID = 'lifecycle-readout';

interface StageBodyProps {
  stage: Stage;
}

/** Shared detail body — the desktop readout panel and the mobile stepper agree. */
function StageBody({ stage }: StageBodyProps) {
  return (
    <>
      <p className="lp-body">{stage.summary}</p>
      <ul className="mt-4 space-y-3" role="list">
        {stage.bullets.map((bullet) => (
          <li key={bullet} className="flex gap-3">
            <span
              className="lp-key mt-[0.2rem] shrink-0 tabular-nums"
              style={{ color: toneColor(stage.tone) }}
              aria-hidden="true"
            >
              —
            </span>
            <span
              className="text-[0.8125rem] leading-relaxed"
              style={{ color: 'var(--text-secondary)' }}
            >
              {bullet}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

export function LifecycleLoopSection() {
  const [activeKey, setActiveKey] = useState<string>('collect');
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>('collect');

  const active = STAGES.find((s) => s.key === activeKey) ?? STAGES[0];

  return (
    <section
      id="lifecycle"
      className="lp-section lp-anchor"
      aria-labelledby="lifecycle-heading"
    >
      <div className="lp-container">
        <div className="lp-grid">
          <div className="lp-rail">
            <span className="lp-rail-name">Lifecycle</span>
            <span className="lp-tag lp-tag-live">Live</span>
          </div>

          <div>
            <h2 id="lifecycle-heading" className="lp-display lp-h2">
              The loop, and what each stage can actually do today.
            </h2>

            <p className="lp-value mt-5 break-words">
              Collect → Train → Deploy → Evaluate → Operate → Comply
            </p>

            <p className="lp-lede mt-5">
              Physical AI is never finished — every deployment feeds the next collection. The six
              stages are not equally mature, so each one carries its own tag: <em>Live</em> where it
              runs against real hardware or real data, <em>Sim</em> where it is proven in simulation
              only, and <em>Gated</em> where the code path exists end to end but a safety interlock
              still stands between it and a real robot.
            </p>

            {/* ---------------------------------------------------------------
                Desktop: the lemniscate plus a readout panel. Hidden below lg,
                where a 600-unit viewBox squeezes r=22 nodes to ~12px.
                --------------------------------------------------------------- */}
            <div className="mt-12 hidden gap-8 lg:grid lg:grid-cols-[minmax(0,1fr)_19rem]">
              <div>
                <svg
                  viewBox="-300 -150 600 300"
                  className="h-auto w-full"
                  role="group"
                  aria-label="Lifecycle loop — select a stage"
                >
                  <defs>
                    {/* Cobalt for the build half, turquoise for the run half,
                        hard split at the Deploy → Evaluate crossover. */}
                    <linearGradient id="lifecycleStroke" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" style={{ stopColor: 'var(--color-primary)' }} />
                      <stop offset="50%" style={{ stopColor: 'var(--color-primary)' }} />
                      <stop offset="50.01%" style={{ stopColor: 'var(--color-accent)' }} />
                      <stop offset="100%" style={{ stopColor: 'var(--color-accent)' }} />
                    </linearGradient>

                    {/* Faint dot matrix — a grid, not a glow. */}
                    <pattern
                      id="lifecycleGrid"
                      x="0"
                      y="0"
                      width="24"
                      height="24"
                      patternUnits="userSpaceOnUse"
                    >
                      <circle cx="1" cy="1" r="0.6" fill="var(--text-muted)" fillOpacity="0.35" />
                    </pattern>

                    {/* One source of truth for the geometry. */}
                    <path id="lifecyclePath" d={INFINITY_PATH} fill="none" />
                  </defs>

                  <rect x={-300} y={-150} width={600} height={300} fill="url(#lifecycleGrid)" />

                  {/* Two static layers: the stroke and the measurement ticks that
                      dash it. The 16px-wide, 14%-opacity halo that used to sit
                      under the path was a bloom by another name, and the corner
                      brackets were a third decorative layer on a diagram whose
                      whole payload is six labelled nodes. Both are gone. */}
                  <use
                    href="#lifecyclePath"
                    stroke="url(#lifecycleStroke)"
                    strokeWidth={4}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <use
                    href="#lifecyclePath"
                    stroke="var(--bg-primary)"
                    strokeOpacity={0.7}
                    strokeWidth={1.5}
                    strokeLinecap="butt"
                    strokeDasharray="2 14"
                  />

                  {/* Crossover marker — the Deploy → Evaluate handoff. */}
                  <circle cx={0} cy={0} r={3} fill="var(--text-tertiary)" />

                  {STAGES.map((stage) => {
                    const isActive = stage.key === activeKey;
                    const isFocused = stage.key === focusKey;
                    const color = toneColor(stage.tone);
                    const nodeRadius = isActive ? 25 : 21;

                    return (
                      <g
                        key={stage.key}
                        className="cursor-pointer"
                        tabIndex={0}
                        role="button"
                        aria-pressed={isActive}
                        aria-controls={READOUT_ID}
                        aria-label={`${stage.label} — ${tagLabel(stage.maturity)}`}
                        onMouseEnter={() => setActiveKey(stage.key)}
                        onFocus={() => {
                          setActiveKey(stage.key);
                          setFocusKey(stage.key);
                        }}
                        onBlur={() => setFocusKey(null)}
                        onClick={() => setActiveKey(stage.key)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            setActiveKey(stage.key);
                          }
                        }}
                      >
                        {/* Selection ring — static; no pulsing status dots. At 0.4
                            it measured below 3:1 against the page, so it now sits
                            at 0.7 and still reads as secondary to the node. */}
                        {isActive && (
                          <circle
                            cx={stage.x}
                            cy={stage.y}
                            r={33}
                            fill="none"
                            stroke={color}
                            strokeOpacity={0.7}
                            strokeWidth={1}
                          />
                        )}

                        {/* Focus indicator — SVG can't carry a Tailwind ring. */}
                        {isFocused && (
                          <circle
                            cx={stage.x}
                            cy={stage.y}
                            r={nodeRadius + 9}
                            fill="none"
                            stroke="var(--text-primary)"
                            strokeWidth={1.5}
                            strokeDasharray="3 3"
                          />
                        )}

                        <circle
                          cx={stage.x}
                          cy={stage.y}
                          r={nodeRadius}
                          fill="var(--bg-primary)"
                          stroke={color}
                          strokeWidth={isActive ? 3 : 2}
                        />

                        {/* Position in the loop, so the order is readable. */}
                        <text
                          x={stage.x}
                          y={stage.y}
                          textAnchor="middle"
                          dominantBaseline="central"
                          className="fill-theme-primary font-mono text-[13px] font-medium"
                        >
                          {stage.index}
                        </text>

                        <text
                          x={stage.x + stage.labelX}
                          y={stage.y + stage.labelY}
                          textAnchor={stage.labelAnchor}
                          className={`text-[14px] font-semibold ${
                            isActive ? 'fill-theme-primary' : 'fill-theme-secondary'
                          }`}
                        >
                          {stage.label}
                        </text>

                        {/* Maturity, on the graphic itself. */}
                        <text
                          x={stage.x + stage.labelX}
                          y={stage.y + stage.labelY + (stage.labelY < 0 ? -14 : 14)}
                          textAnchor={stage.labelAnchor}
                          className="fill-theme-tertiary font-mono text-[10px] tracking-wider uppercase"
                        >
                          {tagLabel(stage.maturity)}
                        </text>
                      </g>
                    );
                  })}
                </svg>

                <p className="lp-note mt-4">
                  The two lobes cross at the centre: that is the Deploy → Evaluate handoff, where
                  building a policy becomes running one. Hover, tab to or click a node to read the
                  stage.
                </p>
              </div>

              {/* Readout panel for the selected stage. aria-live so that moving
                  between nodes is announced — the panel is the only thing that
                  changes, and a screen reader had no way to know it had. */}
              <div id={READOUT_ID} className="lp-panel self-start" aria-live="polite">
                <div
                  className="flex items-center justify-between gap-3 border-b px-4 py-2.5"
                  style={{ borderColor: 'var(--border-color)' }}
                >
                  <span className="lp-key">
                    Stage {active.index} / 6 · {active.label}
                  </span>
                  <span className={`${tagClass(active.maturity)} shrink-0`}>
                    {tagLabel(active.maturity)}
                  </span>
                </div>
                <div className="px-4 py-4" style={{ minHeight: '19rem' }}>
                  <StageBody stage={active} />
                </div>
              </div>
            </div>

            {/* ---------------------------------------------------------------
                Below lg: a vertical stepper. Real buttons, real hit areas.
                --------------------------------------------------------------- */}
            <div className="lp-panel mt-10 overflow-hidden lg:hidden">
              <ul role="list">
                {STAGES.map((stage, i) => {
                  const isOpen = stage.key === openKey;
                  const panelId = `lifecycle-stage-${stage.key}`;

                  return (
                    <li
                      key={stage.key}
                      className={i === 0 ? '' : 'border-t'}
                      style={{ borderColor: 'var(--border-color)' }}
                    >
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        aria-controls={panelId}
                        onClick={() => setOpenKey(isOpen ? null : stage.key)}
                        className="flex w-full items-center gap-3 px-4 py-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset"
                        style={{ minHeight: '3rem' }}
                      >
                        <span
                          className="lp-key w-4 shrink-0 tabular-nums"
                          style={{ color: toneColor(stage.tone) }}
                        >
                          {stage.index}
                        </span>
                        <span className="lp-h3 min-w-0 flex-1">{stage.label}</span>
                        <span className={`${tagClass(stage.maturity)} shrink-0`}>
                          {tagLabel(stage.maturity)}
                        </span>
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 12 12"
                          fill="none"
                          aria-hidden="true"
                          className={`shrink-0 transition-transform duration-200 ${
                            isOpen ? 'rotate-180' : ''
                          }`}
                          style={{ color: 'var(--text-tertiary)' }}
                        >
                          <path
                            d="M2.5 4.5 L6 8 L9.5 4.5"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>

                      {/* Rendered whether or not it is open, and hidden with the
                          attribute. Conditional rendering left the five closed
                          buttons pointing aria-controls at IDs that were not in
                          the document. Same pattern as RunItSection. */}
                      <div id={panelId} hidden={!isOpen} className="px-4 pt-1 pb-4">
                        <StageBody stage={stage} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>

            <p className="lp-note mt-4 lg:hidden">
              Stages 3 and 4 sit on either side of the handoff: Deploy builds and ships the policy,
              Evaluate runs it.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

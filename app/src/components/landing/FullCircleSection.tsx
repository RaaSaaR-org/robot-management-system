/**
 * @file FullCircleSection.tsx
 * @description The page's centrepiece — the six-stage lifecycle drawn as a live
 *              lemniscate, with a signal circulating it and a per-stage maturity
 *              tag because the stages are not equally mature.
 * @feature landing
 *
 * Two things changed when this became the centrepiece rather than a mid-page
 * diagram, and both are load-bearing:
 *
 * 1. The nodes were re-seated so that walking the path IS the lifecycle. The
 *    old layout put Collect/Train/Deploy on the left lobe in reading order,
 *    which meant a pen tracing the curve visited them 1 → 3 → 2 backwards. Now
 *    the traversal reads Collect → Train → Deploy → cross → Evaluate → Operate
 *    → Comply → cross → Collect, so the graphic states the claim instead of
 *    illustrating it. The curve crosses itself twice, and both crossings are
 *    real handoffs: Deploy → Evaluate (a built policy becomes a running one)
 *    and Comply → Collect (a running fleet becomes tomorrow's training data).
 *
 * 2. A lit segment circulates the path and each node pings as it arrives. The
 *    sync is arithmetic, not eyeballed — see NODE_LEAD and the `t` field.
 */

import { useMemo, useState } from 'react';

type Tone = 'dev' | 'ops';
type Maturity = 'live' | 'sim' | 'gated';
type LabelAnchor = 'start' | 'middle' | 'end';

export interface Stage {
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
  /**
   * Where this node sits along the path, as a fraction of pathLength — used to
   * time its ping against the travelling segment. See ARC_INTO_SEGMENT.
   */
  t: number;
  /** Where the label sits relative to the node */
  labelX: number;
  labelY: number;
  labelAnchor: LabelAnchor;
  /** One line, for the strip under the loop. */
  headline: string;
  summary: string;
  bullets: string[];
}

/**
 * The four Béziers are congruent, so each is exactly a quarter of the path.
 * Within a segment the node sits at Bézier parameter 0.5 — but the control
 * points are not symmetric (the tangent is 240 units long at one end and 300 at
 * the other), so param 0.5 is at 0.43344 of the segment's *arc* length, not
 * half. Segments 2 and 4 run the profile in reverse and take the complement.
 * Numerically integrated at 200k samples; being ~2% out would put a ping about
 * 180 ms off its pulse, which is exactly the sort of thing that reads as sloppy
 * rather than as a coincidence.
 */
const ARC_INTO_SEGMENT = 0.43344;
const SEG = 0.25;

// True figure-8 geometry. The curve is a lemniscate traced with 4 cubic Béziers
// that cross each other at the origin. Control points at y=±80 make the curve
// peak at y=±60, x=±102.5, so each node sits exactly on the top or bottom of
// its loop.
//
// Exported so the test can assert the property the whole redesign rests on:
// walking the path in order visits the stages in lifecycle order.
export const STAGES: Stage[] = [
  {
    key: 'collect',
    index: 1,
    label: 'Collect',
    maturity: 'live',
    tone: 'dev',
    x: -102.5,
    y: 60,
    t: 3 * SEG + SEG * (1 - ARC_INTO_SEGMENT),
    labelX: 0,
    labelY: 42,
    labelAnchor: 'middle',
    headline: 'Every episode, versioned.',
    summary:
      'Demonstrations, teleoperation sessions and real LiDAR scans become versioned datasets.',
    bullets: [
      'Trim the wobbly takes or drop the failed ones and you get a new version — the original recording is never touched, and every version knows where it came from.',
      'Walk a scanner around a room and it comes back as a digital twin you can navigate and simulate in. Proven on a real scan of our own lab.',
      'Teleoperation and VR sessions record straight into a training-ready dataset — no export step. In simulation so far.',
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
    t: 0,
    labelX: -44,
    labelY: 2,
    labelAnchor: 'end',
    headline: 'Your data, your model.',
    summary: 'Fine-tune on your own data without leaving the LeRobot format.',
    bullets: [
      'Your datasets stay in the open LeRobot format and sync with HuggingFace both ways — bring them in, take them out again.',
      'Six base models to choose from. SmolVLA walks the whole circle today; GR00T N1.7 trains natively.',
      'The heavy lifting runs on whichever GPU box you point at it, so training never competes with the machine running your fleet.',
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
    y: -60,
    t: SEG * ARC_INTO_SEGMENT,
    labelX: 0,
    labelY: -42,
    labelAnchor: 'middle',
    headline: 'Shipped like software.',
    summary: 'Ship a model to a robot the way you would ship software.',
    bullets: [
      'A model registry, staged rollouts with a health check at every step, and rollback in one click.',
      'Updates go out over the air cryptographically signed, so a robot only ever installs what you actually shipped.',
      'The bridge to a real G1 is deliberately locked. It rehearses without moving by default, takes two separate arming steps to go live, and never drives the legs.',
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
    t: SEG + SEG * (1 - ARC_INTO_SEGMENT),
    labelX: 0,
    labelY: 42,
    labelAnchor: 'middle',
    headline: 'Scored, and second-guessed.',
    summary: 'Score a model in simulation, and try to catch yourself being optimistic.',
    bullets: [
      'Every run scored attempt by attempt: success rate, where it went wrong, and how it compares to the model it would replace.',
      'Two built-in traps you are meant to fail. A do-nothing model that must score zero, and a run given the wrong instruction that must score worse. The first time we ran them, they overturned a result we liked.',
      'A pick-and-place room for the G1 and its hands, mirroring the workflow NVIDIA ships for GR00T.',
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
    t: 2 * SEG,
    labelX: 44,
    labelY: 2,
    labelAnchor: 'start',
    headline: 'Plan first, permission second.',
    summary: 'A local model plans; the safety layer decides whether the plan gets to run.',
    bullets: [
      'Say “geh zum Regal RACK-A” and the robot turns it into a plan you can read step by step before it walks a single one — over the same controls a real G1 uses.',
      'A keep-out zone stopped a two-metre walk 0.48 m clear of the rack and refused the next command until it was cleared. Reproduced twice.',
      'Reading a real, powered G1 works today. Anything that moves one is still simulation.',
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
    t: 2 * SEG + SEG * ARC_INTO_SEGMENT,
    labelX: 0,
    labelY: -42,
    labelAnchor: 'middle',
    headline: 'Provable, not asserted.',
    summary: 'Record-keeping a regulator can check, and erasure that reaches the robot.',
    bullets: [
      'An audit trail that cannot be edited quietly — alter one entry and the check fails and names it (EU AI Act Art. 12).',
      'Records of processing, a self-service portal covering all seven kinds of data-subject request, legal holds and retention schedules.',
      'A deletion request reaches the robots too: it wipes what they remember, and tells you which ones were switched off rather than counting them as done.',
    ],
  },
];

// True lemniscate / figure-8. Four cubic Béziers form two teardrop loops that
// cross at (0, 0). At the crossing the curve passes through twice with tangents
// (60, 80) and (-60, 80) — a visible X, exactly like the DevOps ∞.
const INFINITY_PATH = [
  'M -160 0',
  'C -160 -80, -60 -80, 0 0',
  'C 60 80, 160 80, 160 0',
  'C 160 -80, 60 -80, 0 0',
  'C -60 80, -160 80, -160 0',
  'Z',
].join(' ');

/** One lap. Slow enough to read as circulation rather than as a spinner. */
const LOOP_SECONDS = 11;

/**
 * The travelling dash is 44 units of a 1000-unit path and its leading edge runs
 * ahead of the animation's own progress by exactly that much (see the dash
 * geometry in index.css), so a node at fraction `t` is reached at t − 0.044 of
 * the cycle.
 */
const NODE_LEAD = 0.044;

/**
 * Negative delay that puts frame 0% of the ping at the moment the head lands.
 * Negative rather than positive so the cycle is already underway on mount —
 * a positive delay would leave every node dark for up to a full lap.
 */
export function pingDelaySeconds(t: number): number {
  const phase = (((t - NODE_LEAD) % 1) + 1) % 1;
  return -((1 - phase) % 1) * LOOP_SECONDS;
}

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
const READOUT_ID = 'fullcircle-readout';

interface StageBodyProps {
  stage: Stage;
}

/** Shared detail body — the desktop readout panel and the mobile stepper agree. */
function StageBody({ stage }: StageBodyProps) {
  return (
    <>
      <p className="lp-body">{stage.summary}</p>
      <ul className="mt-4 grid gap-3 lg:grid-cols-3 lg:gap-x-8" role="list">
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

export function FullCircleSection() {
  const [activeKey, setActiveKey] = useState<string>('collect');
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>('collect');

  // Checked once. The circulating segment and the pings are omitted entirely
  // rather than left to the global duration override, which would freeze the
  // dash mid-curve and leave a bright stub parked on the path.
  const prefersReduced = useMemo(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  );

  const active = STAGES.find((s) => s.key === activeKey) ?? STAGES[0];

  return (
    <section
      id="circle"
      className="lp-section lp-band lp-anchor"
      aria-labelledby="fullcircle-heading"
    >
      <div className="lp-container">
        {/* Centred header — the one section on the page that drops the legend
            rail, because it is the one section the whole page is arranged
            around. */}
        <div className="mx-auto max-w-3xl text-center">
          <p className="lp-key flex items-center justify-center gap-3">
            <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Full circle</span>
            <span className="lp-tag lp-tag-live">6 stages</span>
          </p>

          <h2 id="fullcircle-heading" className="lp-display lp-h2 mt-6">
            Collect. Train. Deploy. Evaluate. Operate. Comply.
            <br />
            Then again.
          </h2>

          <p className="lp-lede mx-auto mt-6">
            One platform carries a robot&rsquo;s whole working life. Data becomes a model, the
            model ships to the fleet, the fleet gets measured — and what it does on shift becomes
            the next dataset. No export step between the stages, because there is nothing to
            export to.
          </p>
        </div>

        {/* ---------------------------------------------------------------
            Desktop: the loop, large and centred. Hidden below lg, where a
            600-unit viewBox squeezes r=22 nodes to ~12px.
            --------------------------------------------------------------- */}
        <div className="mt-14 hidden lg:block">
          <svg
            viewBox="-300 -150 600 300"
            className="mx-auto h-auto w-full"
            style={
              {
                maxWidth: '52rem',
                '--lp-loop-duration': `${LOOP_SECONDS}s`,
              } as React.CSSProperties
            }
            role="group"
            aria-label="Lifecycle loop — select a stage"
          >
            <defs>
              {/* Cobalt for the build half, turquoise for the run half,
                  hard split at the crossover. */}
              <linearGradient id="fullcircleStroke" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" style={{ stopColor: 'var(--color-primary)' }} />
                <stop offset="50%" style={{ stopColor: 'var(--color-primary)' }} />
                <stop offset="50.01%" style={{ stopColor: 'var(--color-accent)' }} />
                <stop offset="100%" style={{ stopColor: 'var(--color-accent)' }} />
              </linearGradient>

              {/* Faint dot matrix — a grid, not a glow. */}
              <pattern
                id="fullcircleGrid"
                x="0"
                y="0"
                width="24"
                height="24"
                patternUnits="userSpaceOnUse"
              >
                <circle cx="1" cy="1" r="0.6" fill="var(--text-muted)" fillOpacity="0.35" />
              </pattern>

              {/* One source of truth for the geometry. pathLength normalises it
                  to 1000 units so the dash lengths in index.css and the node
                  fractions above are the same arithmetic. */}
              <path id="fullcirclePath" d={INFINITY_PATH} fill="none" pathLength={1000} />
            </defs>

            <rect x={-300} y={-150} width={600} height={300} fill="url(#fullcircleGrid)" />

            {/* Two static layers: the stroke and the measurement ticks that
                dash it. No halo, no corner brackets — the payload is six
                labelled nodes. */}
            <use
              href="#fullcirclePath"
              stroke="url(#fullcircleStroke)"
              strokeWidth={4}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <use
              href="#fullcirclePath"
              stroke="var(--bg-secondary)"
              strokeOpacity={0.7}
              strokeWidth={1.5}
              strokeLinecap="butt"
              strokeDasharray="2 14"
            />

            {/* The circulating signal: a dim wake with a bright head sharing a
                leading edge. Decorative, so it is hidden from the tree. */}
            {!prefersReduced && (
              <g aria-hidden="true">
                <use
                  href="#fullcirclePath"
                  className="lp-loop-trail"
                  stroke="var(--color-signal-measured)"
                  strokeOpacity={0.28}
                  strokeWidth={7}
                  strokeLinecap="round"
                />
                <use
                  href="#fullcirclePath"
                  className="lp-loop-head"
                  stroke="var(--color-signal-measured)"
                  strokeWidth={5}
                  strokeLinecap="round"
                />
              </g>
            )}

            {/* Crossover marker. The curve passes through here twice, and both
                passes are handoffs — see the caption. */}
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
                  {/* Ping — fires as the travelling head reaches this node. */}
                  {!prefersReduced && (
                    <circle
                      cx={stage.x}
                      cy={stage.y}
                      r={nodeRadius + 5}
                      fill="none"
                      stroke={color}
                      strokeWidth={1.5}
                      className="lp-node-ping"
                      style={{ animationDelay: `${pingDelaySeconds(stage.t)}s` }}
                      aria-hidden="true"
                    />
                  )}

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
                    fill="var(--bg-secondary)"
                    stroke={color}
                    strokeWidth={isActive ? 3 : 2}
                  />

                  {/* Position in the loop, so the order is readable. */}
                  <text
                    x={stage.x}
                    y={stage.y}
                    textAnchor="middle"
                    dominantBaseline="central"
                    className="fill-ink-primary font-mono text-[13px] font-medium"
                  >
                    {stage.index}
                  </text>

                  <text
                    x={stage.x + stage.labelX}
                    y={stage.y + stage.labelY}
                    textAnchor={stage.labelAnchor}
                    className={`text-[14px] font-semibold ${
                      isActive ? 'fill-ink-primary' : 'fill-ink-secondary'
                    }`}
                  >
                    {stage.label}
                  </text>

                  {/* Maturity, on the graphic itself. */}
                  <text
                    x={stage.x + stage.labelX}
                    y={stage.y + stage.labelY + (stage.labelY < 0 ? -14 : 14)}
                    textAnchor={stage.labelAnchor}
                    className="fill-ink-tertiary font-mono text-[10px] tracking-wider uppercase"
                  >
                    {tagLabel(stage.maturity)}
                  </text>
                </g>
              );
            })}
          </svg>

          <p className="lp-note mx-auto mt-6 text-center">
            The path crosses itself twice, and both crossings are real handoffs: <strong
              style={{ color: 'var(--text-primary)', fontWeight: 600 }}
            >
              Deploy → Evaluate
            </strong>
            , where a built policy becomes a running one, and{' '}
            <strong style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
              Comply → Collect
            </strong>
            , where a working fleet becomes the next training set. Hover, tab to or click a node to
            read the stage.
          </p>

          {/* Readout panel for the selected stage. aria-live so that moving
              between nodes is announced — the panel is the only thing that
              changes, and a screen reader had no way to know it had. */}
          <div id={READOUT_ID} className="lp-panel mt-10" aria-live="polite">
            <div
              className="flex items-center justify-between gap-3 border-b px-5 py-3"
              style={{ borderColor: 'var(--border-color)' }}
            >
              <span className="lp-key">
                Stage {active.index} / 6 · {active.label}
              </span>
              <span className="lp-h3 hidden min-w-0 flex-1 truncate text-center xl:block">
                {active.headline}
              </span>
              <span className={`${tagClass(active.maturity)} shrink-0`}>
                {tagLabel(active.maturity)}
              </span>
            </div>
            <div className="px-5 py-5" style={{ minHeight: '11rem' }}>
              <StageBody stage={active} />
            </div>
          </div>
        </div>

        {/* ---------------------------------------------------------------
            Below lg: a vertical stepper. Real buttons, real hit areas.
            --------------------------------------------------------------- */}
        <div className="lp-panel mt-12 overflow-hidden lg:hidden">
          <ul role="list">
            {STAGES.map((stage, i) => {
              const isOpen = stage.key === openKey;
              const panelId = `fullcircle-stage-${stage.key}`;

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
          Stages 3 and 4 sit on either side of the first handoff — Deploy builds and ships the
          policy, Evaluate runs it. Stage 6 hands back to stage 1: a working fleet is the next
          training set.
        </p>

        <p className="lp-note mx-auto mt-10 max-w-3xl text-center">
          The six stages are not equally mature, so each carries its own tag. <em>Live</em> where
          it runs against real hardware or real data, <em>Sim</em> where it is proven in
          simulation only, and <em>Gated</em> where it works end to end but a safety interlock
          still stands between it and a real robot.
        </p>
      </div>
    </section>
  );
}

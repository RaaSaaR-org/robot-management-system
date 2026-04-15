/**
 * @file LifecycleLoopSection.tsx
 * @description Interactive DevOps-style infinity loop for the Physical AI lifecycle
 * @feature landing
 */

import { useState, type ComponentType, type SVGProps } from 'react';
import { Database, Brain, Rocket, CheckCircle2, Activity, ShieldCheck } from 'lucide-react';

type Tone = 'cobalt' | 'turquoise';
type LabelAnchor = 'start' | 'middle' | 'end';

interface Stage {
  key: string;
  label: string;
  story: string;
  tone: Tone;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
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
    label: 'Collect',
    story: 'Input',
    tone: 'cobalt',
    Icon: Database,
    x: -102.5,
    y: -60,
    labelX: 0,
    labelY: -42,
    labelAnchor: 'middle',
    summary: 'Capture demonstrations, teleop sessions, and sensor streams from real robots.',
    bullets: [
      'Multi-modal recording — video, joint state, force, audio',
      'Teleop playback and human-demo capture',
      'Dataset versioning and provenance from day one',
    ],
  },
  {
    key: 'train',
    label: 'Train',
    story: 'Intelligence',
    tone: 'cobalt',
    Icon: Brain,
    x: -160,
    y: 0,
    labelX: -44,
    labelY: 2,
    labelAnchor: 'end',
    summary: 'Fine-tune Vision-Language-Action foundation models on your own data.',
    bullets: [
      'SmolVLA, π0.5, and GR00T adapters out of the box',
      'LoRA fine-tuning on Mac (MPS) or GPU',
      'Versioned model registry with lineage tracking',
    ],
  },
  {
    key: 'deploy',
    label: 'Deploy',
    story: 'Action',
    tone: 'cobalt',
    Icon: Rocket,
    x: -102.5,
    y: 60,
    labelX: 0,
    labelY: 42,
    labelAnchor: 'middle',
    summary: 'Push trained models to edge devices with staged rollouts and rollback.',
    bullets: [
      'OTA rollout to Raspberry Pi, Jetson, or x86',
      'Canary rollouts with per-stage health checks',
      'One-click rollback to any previous version',
    ],
  },
  {
    key: 'evaluate',
    label: 'Evaluate',
    story: 'Quality',
    tone: 'turquoise',
    Icon: CheckCircle2,
    x: 102.5,
    y: 60,
    labelX: 0,
    labelY: 42,
    labelAnchor: 'middle',
    summary: 'Validate behavior in simulation and on real hardware before production.',
    bullets: [
      'MuJoCo / Isaac Lab sim jobs with real-time metrics',
      'Safety-envelope and drift checks',
      'Human-in-the-loop review workflows',
    ],
  },
  {
    key: 'operate',
    label: 'Operate',
    story: 'Scale',
    tone: 'turquoise',
    Icon: Activity,
    x: 160,
    y: 0,
    labelX: 44,
    labelY: 2,
    labelAnchor: 'start',
    summary: 'Manage fleets in real time with natural-language control and live telemetry.',
    bullets: [
      'Fleet dashboard and live telemetry streams',
      'Natural-language command interface',
      'A2A task orchestration across robots',
    ],
  },
  {
    key: 'comply',
    label: 'Comply',
    story: 'Trust',
    tone: 'turquoise',
    Icon: ShieldCheck,
    x: 102.5,
    y: -60,
    labelX: 0,
    labelY: -42,
    labelAnchor: 'middle',
    summary: 'Audit-ready for the EU AI Act, GDPR, and industry certification.',
    bullets: [
      'Immutable decision logs and explainability',
      'Human approval workflows for high-risk actions',
      'GDPR self-service portal',
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

const COBALT = '#2A5FFF';
const TURQUOISE = '#18E4C3';

export function LifecycleLoopSection() {
  const [activeKey, setActiveKey] = useState<string>('collect');
  const active = STAGES.find((s) => s.key === activeKey) ?? STAGES[0];

  return (
    <section className="py-24 section-primary">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section header */}
        <div className="text-center mb-12">
          <p className="text-turquoise font-mono text-sm mb-4 tracking-wider uppercase">
            The Lifecycle Loop
          </p>
          <h2 className="text-3xl sm:text-4xl font-bold text-theme-primary mb-4">
            One continuous loop, six phases
          </h2>
          <p className="text-theme-secondary text-lg max-w-2xl mx-auto">
            Physical AI is never &ldquo;done.&rdquo; Every deployment feeds the next collection.
            Hover a phase to see what happens inside it.
          </p>
        </div>

        <div className="grid lg:grid-cols-5 gap-10 items-center">
          {/* Infinity loop */}
          <div className="lg:col-span-3">
            <svg
              viewBox="-300 -150 600 300"
              className="w-full h-auto"
              role="img"
              aria-label="Physical AI lifecycle infinity loop"
            >
              <defs>
                {/* Gradient: cobalt for left lobe, turquoise for right lobe, hard split at center */}
                <linearGradient id="lifecycleStroke" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor={COBALT} stopOpacity="0.95" />
                  <stop offset="50%" stopColor={COBALT} stopOpacity="0.95" />
                  <stop offset="50.01%" stopColor={TURQUOISE} stopOpacity="0.95" />
                  <stop offset="100%" stopColor={TURQUOISE} stopOpacity="0.95" />
                </linearGradient>

                {/* Bloom filter — wider blur on a second pass for neon aura */}
                <filter id="lifecycleGlow" x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="6" result="blurBig" />
                  <feGaussianBlur stdDeviation="2" in="SourceGraphic" result="blurSmall" />
                  <feMerge>
                    <feMergeNode in="blurBig" />
                    <feMergeNode in="blurSmall" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>

                {/* Particle glow (tighter, brighter) */}
                <filter id="particleGlow" x="-200%" y="-200%" width="500%" height="500%">
                  <feGaussianBlur stdDeviation="2.5" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>

                {/* HUD grid: faint dot matrix */}
                <pattern id="hudGrid" x="0" y="0" width="24" height="24" patternUnits="userSpaceOnUse">
                  <circle cx="1" cy="1" r="0.6" fill="#F5F5F4" fillOpacity="0.07" />
                </pattern>

                {/* Shared path definition — everything renders from this one source */}
                <path id="lifecyclePath" d={INFINITY_PATH} fill="none" />
              </defs>

              {/* HUD grid background */}
              <rect x={-300} y={-150} width={600} height={300} fill="url(#hudGrid)" />

              {/* Corner brackets (command-center feel) */}
              <g stroke="#F5F5F4" strokeOpacity={0.25} strokeWidth={1.2} fill="none">
                <path d="M -290 -130 L -290 -140 L -280 -140" />
                <path d="M 290 -130 L 290 -140 L 280 -140" />
                <path d="M -290 130 L -290 140 L -280 140" />
                <path d="M 290 130 L 290 140 L 280 140" />
              </g>

              {/* Soft outer aura */}
              <use
                href="#lifecyclePath"
                stroke="url(#lifecycleStroke)"
                strokeOpacity={0.18}
                strokeWidth={18}
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              {/* Main stroke with bloom */}
              <use
                href="#lifecyclePath"
                stroke="url(#lifecycleStroke)"
                strokeWidth={4}
                strokeLinecap="round"
                strokeLinejoin="round"
                filter="url(#lifecycleGlow)"
              />

              {/* Flowing energy dashes — subtle marching-ants on top of the main stroke */}
              <use
                href="#lifecyclePath"
                stroke="#F5F5F4"
                strokeOpacity={0.55}
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeDasharray="2 14"
              >
                <animate
                  attributeName="stroke-dashoffset"
                  from="0"
                  to="-160"
                  dur="6s"
                  repeatCount="indefinite"
                />
              </use>

              {/* Data particles flowing along the path */}
              <circle r={3.5} fill="#F5F5F4" filter="url(#particleGlow)">
                <animateMotion dur="10s" repeatCount="indefinite" rotate="auto">
                  <mpath href="#lifecyclePath" />
                </animateMotion>
              </circle>
              <circle r={2.5} fill={TURQUOISE} filter="url(#particleGlow)">
                <animateMotion dur="10s" begin="-3.33s" repeatCount="indefinite">
                  <mpath href="#lifecyclePath" />
                </animateMotion>
              </circle>
              <circle r={2.5} fill={COBALT} filter="url(#particleGlow)">
                <animateMotion dur="10s" begin="-6.66s" repeatCount="indefinite">
                  <mpath href="#lifecyclePath" />
                </animateMotion>
              </circle>

              {/* Crossover pulse rings */}
              <circle cx={0} cy={0} r={6} fill="none" stroke="#F5F5F4" strokeWidth={1}>
                <animate attributeName="r" values="4;24;4" dur="3s" repeatCount="indefinite" />
                <animate attributeName="stroke-opacity" values="0.7;0;0.7" dur="3s" repeatCount="indefinite" />
              </circle>
              <circle cx={0} cy={0} r={6} fill="none" stroke="#F5F5F4" strokeWidth={1}>
                <animate attributeName="r" values="4;24;4" dur="3s" begin="-1.5s" repeatCount="indefinite" />
                <animate attributeName="stroke-opacity" values="0.7;0;0.7" dur="3s" begin="-1.5s" repeatCount="indefinite" />
              </circle>
              <circle cx={0} cy={0} r={3} fill="#F5F5F4" opacity={0.85} />

              {/* Nodes */}
              {STAGES.map((stage) => {
                const isActive = stage.key === activeKey;
                const color = stage.tone === 'cobalt' ? COBALT : TURQUOISE;
                const nodeRadius = isActive ? 26 : 22;
                return (
                  <g
                    key={stage.key}
                    className="cursor-pointer"
                    onMouseEnter={() => setActiveKey(stage.key)}
                    onFocus={() => setActiveKey(stage.key)}
                    onClick={() => setActiveKey(stage.key)}
                    tabIndex={0}
                    role="button"
                    aria-label={`${stage.label} — ${stage.story}`}
                  >
                    {/* Halo */}
                    {isActive && (
                      <circle cx={stage.x} cy={stage.y} r={36} fill={color} fillOpacity={0.18}>
                        <animate
                          attributeName="r"
                          values="32;40;32"
                          dur="2s"
                          repeatCount="indefinite"
                        />
                        <animate
                          attributeName="fill-opacity"
                          values="0.25;0.08;0.25"
                          dur="2s"
                          repeatCount="indefinite"
                        />
                      </circle>
                    )}

                    {/* Node disc */}
                    <circle
                      cx={stage.x}
                      cy={stage.y}
                      r={nodeRadius}
                      fill="#141414"
                      stroke={color}
                      strokeWidth={3}
                      className="transition-all duration-200"
                    />

                    {/* Icon */}
                    <foreignObject
                      x={stage.x - 13}
                      y={stage.y - 13}
                      width={26}
                      height={26}
                      style={{ pointerEvents: 'none' }}
                    >
                      <stage.Icon
                        width={26}
                        height={26}
                        stroke={color}
                        strokeWidth={2}
                        fill="none"
                      />
                    </foreignObject>

                    {/* Label */}
                    <text
                      x={stage.x + stage.labelX}
                      y={stage.y + stage.labelY}
                      textAnchor={stage.labelAnchor}
                      className={`font-semibold text-[14px] ${
                        isActive ? 'fill-theme-primary' : 'fill-theme-secondary'
                      }`}
                    >
                      {stage.label}
                    </text>
                    {/* Story word */}
                    <text
                      x={stage.x + stage.labelX}
                      y={stage.y + stage.labelY + (stage.labelY < 0 ? -14 : 14)}
                      textAnchor={stage.labelAnchor}
                      className="font-mono text-[10px] fill-theme-muted uppercase tracking-wider"
                    >
                      {stage.story}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          {/* Details panel */}
          <div className="lg:col-span-2">
            <div className="card p-6 lg:p-8 min-h-[320px]">
              <div className="flex items-center gap-3 mb-3">
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center border-2 ${
                    active.tone === 'cobalt'
                      ? 'border-cobalt bg-cobalt/10 text-cobalt'
                      : 'border-turquoise bg-turquoise/10 text-turquoise'
                  }`}
                >
                  <active.Icon width={20} height={20} />
                </div>
                <div>
                  <div className="text-theme-primary font-semibold text-lg leading-tight">{active.label}</div>
                  <div className="font-mono text-xs text-theme-muted uppercase tracking-wider">
                    {active.story}
                  </div>
                </div>
              </div>
              <p className="text-theme-secondary mb-5">{active.summary}</p>
              <ul className="space-y-2">
                {active.bullets.map((bullet) => (
                  <li key={bullet} className="flex items-start gap-2 text-theme-secondary text-sm">
                    <span
                      className={
                        active.tone === 'cobalt' ? 'text-cobalt mt-1' : 'text-turquoise mt-1'
                      }
                      aria-hidden
                    >
                      ▸
                    </span>
                    <span>{bullet}</span>
                  </li>
                ))}
              </ul>
            </div>
            <p className="text-theme-muted font-mono text-xs mt-3 text-center lg:text-left">
              Hover or tap a node to explore that phase.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

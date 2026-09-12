/**
 * @file FullCircleSection.tsx
 * @description The Embodied Loop: an interactive six-stage Physical AI lifecycle.
 * @feature landing
 */

import { memo, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Pause, Play } from 'lucide-react';
import { scrollToSection } from './scrollToSection';
import './embodied-loop.css';

type Maturity = 'live' | 'sim' | 'gated';

export interface Stage {
  key: string;
  index: number;
  label: string;
  maturity: Maturity;
  headline: string;
  summary: string;
  bullets: string[];
}

export const STAGES: Stage[] = [
  {
    key: 'collect',
    index: 1,
    label: 'Collect',
    maturity: 'live',
    headline: 'Every episode, versioned.',
    summary:
      'Demonstrations, teleoperation and real LiDAR scans become versioned datasets in an open format.',
    bullets: [
      'Trim the wobbly takes and you get a new version; the original recording is never touched.',
      'A scanner we walked around our lab came back as a twin you can navigate and simulate in.',
    ],
  },
  {
    key: 'train',
    index: 2,
    label: 'Train',
    maturity: 'live',
    headline: 'Your data, your model.',
    summary:
      'Fine-tune on your own data, in the open LeRobot format, and sync with HuggingFace both ways.',
    bullets: [
      // Four vendors: HuggingFace, Physical Intelligence, Stanford and NVIDIA —
      // the makers behind the six entries of `BaseModels` in
      // server/src/types/vla.types.ts. pi0.5 is scaffolded in the sibling
      // vla-server and is deliberately not counted: it is not selectable.
      'Six base models from four vendors are selectable as the starting point for a run.',
      // The page's single mention of NVIDIA's model, and the only claim about
      // it: the training wizard lists it (wizard/wizardModel.ts), and SmolVLA
      // is the one that has been through train, serve and evaluate here.
      'GR00T N1.7 trains natively; SmolVLA has been fine-tuned, served and scored here end to end.',
    ],
  },
  {
    key: 'deploy',
    index: 3,
    // Gated, not Live: the registry, canary and rollback paths are real, but the
    // only bridge to a real G1 refuses to move unless it is explicitly armed, so
    // no model has ever been shipped to physical hardware. See the second bullet.
    label: 'Deploy',
    maturity: 'gated',
    headline: 'Shipped like software.',
    summary: 'A registry, staged rollouts and signed updates — with the last gate still shut.',
    bullets: [
      'A model registry, staged rollout with a health check at each step, rollback in one click.',
      'Updates are cryptographically signed, and the bridge to a real G1 stays locked behind two arming steps.',
    ],
  },
  {
    key: 'evaluate',
    index: 4,
    label: 'Evaluate',
    maturity: 'sim',
    headline: 'Scored, and second-guessed.',
    summary:
      'Every run scored attempt by attempt; the first traps we ran overturned a result we liked.',
    bullets: [
      'Success rate, where it went wrong, and how it compares to the model it would replace.',
      'Two traps you are meant to fail: a do-nothing model must score zero, a misdirected run worse.',
    ],
  },
  {
    key: 'operate',
    index: 5,
    label: 'Operate',
    maturity: 'sim',
    headline: 'Plan first, permission second.',
    summary: 'A local model plans; the safety layer decides whether the plan gets to run.',
    bullets: [
      'Say “geh zum Regal RACK-A” and read the plan step by step before the robot walks one.',
      // "in simulation" is the qualifier that makes the number true; the Sim tag
      // says the same thing, but a bullet quoting a measurement should carry it.
      'An enforced keep-out zone stopped a two-metre walk 0.48 m clear of the rack, in simulation.',
    ],
  },
  {
    key: 'comply',
    index: 6,
    label: 'Comply',
    maturity: 'live',
    headline: 'Provable, not asserted.',
    summary:
      'Record-keeping a regulator can check (EU AI Act Art. 12), and erasure that reaches the robot.',
    bullets: [
      'An audit trail that cannot be edited quietly — alter an entry and the check names it.',
      'A deletion request wipes what the robots remember, and names the ones that were switched off.',
    ],
  },
];

/**
 * Where a stage panel sends a reader who wants more than two bullets. Two kinds,
 * because the detail now lives in two places: the Proof section further down the
 * page, and docs/platform.md. The union keeps the call site honest — no
 * non-null assertion, and no `scrollToSection` on a route, which only handles
 * `#…` and would let the browser follow a docs href out of the HashRouter demo
 * build (see scrollToSection.ts). Three labels on one `#proof` target is
 * deliberate: the label says what the reader will see there.
 */
export type StageLink =
  { kind: 'anchor'; href: string; label: string } | { kind: 'doc'; to: string; label: string };

export const STAGE_LINKS: Record<string, StageLink> = {
  collect: {
    kind: 'doc',
    to: '/docs/platform#the-data-engine',
    label: 'Read about the data engine',
  },
  train: { kind: 'doc', to: '/docs/platform#models', label: 'See which models are ready' },
  deploy: { kind: 'anchor', href: '#proof', label: 'See the deployment gates hold' },
  evaluate: { kind: 'anchor', href: '#proof', label: 'See the simulation evidence' },
  operate: { kind: 'anchor', href: '#proof', label: 'Watch it stop' },
  comply: {
    kind: 'doc',
    to: '/docs/platform#ownership-and-the-record',
    label: 'Read about ownership and the record',
  },
};

const READOUT_ID = 'fullcircle-readout';

function tagLabel(maturity: Maturity): string {
  return maturity === 'live' ? 'Live' : maturity === 'gated' ? 'Gated' : 'Sim';
}

/** Six stops following one continuous figure-eight, including its return crossing. */
const STAGE_ANGLES = [
  -Math.PI / 2,
  -Math.PI / 4,
  Math.PI / 4,
  Math.PI / 2,
  (3 * Math.PI) / 4,
  (5 * Math.PI) / 4,
];
export function stagePosition(index: number): { x: number; y: number } {
  const angle = STAGE_ANGLES[(((index - 1) % STAGES.length) + STAGES.length) % STAGES.length];
  return {
    x: 50 + 40 * Math.sin(angle),
    y: 50 + (155 / 480) * 100 * Math.sin(2 * angle),
  };
}

function infinityPath(start = -Math.PI / 2, end = (3 * Math.PI) / 2): string {
  return Array.from({ length: 241 }, (_, i) => {
    const angle = start + ((end - start) * i) / 240;
    return `${i ? 'L' : 'M'}${500 + 400 * Math.sin(angle)},${240 + 155 * Math.sin(2 * angle)}`;
  }).join(' ');
}
const LOOP_PATH = infinityPath();
const CROSSING_PATH = infinityPath(Math.PI - 0.1, Math.PI + 0.1);

export const FullCircleSection = memo(function FullCircleSection() {
  const [activeKey, setActiveKey] = useState('collect');
  const [paused, setPaused] = useState(false);
  const active = STAGES.find((stage) => stage.key === activeKey) ?? STAGES[0];
  const link = STAGE_LINKS[active.key];

  return (
    <section id="circle" className="embodied-loop lp-anchor" aria-labelledby="fullcircle-heading">
      <div className="lp-container">
        <div className="embodied-loop-intro">
          <p className="embodied-loop-eyebrow">
            <span /> THE PHYSICAL AI LIFECYCLE
          </p>
          <h2 id="fullcircle-heading" className="lp-display">
            The Embodied <span>Loop.</span>
          </h2>
          <p className="embodied-loop-promise">Every deployment starts the next discovery.</p>
          <p className="embodied-loop-description">
            Experience becomes data. Data becomes capability. Capability goes back into the world.
            Connect the whole journey in one workspace, with evidence and human oversight at every
            turn.
          </p>
        </div>

        <div className="embodied-loop-workspace" data-paused={paused}>
          <div className="embodied-loop-visual">
            <div
              className="embodied-loop-orbit"
              role="group"
              aria-label="The Embodied Loop — select a stage"
            >
              <svg className="embodied-loop-paths" viewBox="0 0 1000 480" aria-hidden="true">
                <defs>
                  <linearGradient id="embodiedLoopGradient" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#98f2d5" />
                    <stop offset="48%" stopColor="#9bdaf2" />
                    <stop offset="100%" stopColor="#b8a0ff" />
                  </linearGradient>
                </defs>
                <path d={LOOP_PATH} className="embodied-loop-aura" />
                <path d={LOOP_PATH} className="embodied-loop-ribbon" />
                <path d={LOOP_PATH} className="embodied-loop-track" />
                <path d={LOOP_PATH} className="embodied-loop-signal" pathLength="1000" />
                <path
                  d={LOOP_PATH}
                  className="embodied-loop-signal embodied-loop-signal-secondary"
                  pathLength="1000"
                />
                <path
                  d={infinityPath(Math.PI - 0.035, Math.PI + 0.035)}
                  className="embodied-loop-crossing-shadow"
                />
                <path d={CROSSING_PATH} className="embodied-loop-ribbon" />
                <path d={CROSSING_PATH} className="embodied-loop-track" />
                {STAGES.map((stage) => {
                  const point = stagePosition(stage.index);
                  return (
                    <g
                      key={stage.key}
                      className="embodied-loop-marker"
                      data-active={activeKey === stage.key}
                      transform={`translate(${point.x * 10} ${point.y * 4.8})`}
                    >
                      <circle r="17" />
                      <text textAnchor="middle" dominantBaseline="central">
                        {stage.index}
                      </text>
                    </g>
                  );
                })}
              </svg>
              <div className="embodied-loop-lobe embodied-loop-lobe-left" aria-hidden="true">
                <span>FROM THE WORLD</span>
                <strong>Experience</strong>
              </div>
              <div className="embodied-loop-lobe embodied-loop-lobe-right" aria-hidden="true">
                <span>BACK TO THE WORLD</span>
                <strong>Intelligence</strong>
              </div>
              <div className="embodied-loop-stages">
                {STAGES.map((stage) => {
                  const point = stagePosition(stage.index);
                  return (
                    <button
                      key={stage.key}
                      type="button"
                      className="embodied-loop-node"
                      style={
                        {
                          '--node-x': `${point.x}%`,
                          '--node-y': `${point.y}%`,
                        } as CSSProperties
                      }
                      aria-label={`${stage.label} — ${tagLabel(stage.maturity)}`}
                      aria-pressed={activeKey === stage.key}
                      aria-controls={READOUT_ID}
                      onClick={() => setActiveKey(stage.key)}
                    >
                      <span className="embodied-loop-node-index">0{stage.index}</span>
                      <span className="embodied-loop-node-label">{stage.label}</span>
                      <span className={`embodied-loop-tag embodied-loop-tag-${stage.maturity}`}>
                        {tagLabel(stage.maturity)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="embodied-loop-visual-footer">
              <span>Select a stage. Follow the loop.</span>
              <button
                type="button"
                className="embodied-loop-motion"
                aria-label={paused ? 'Play loop animation' : 'Pause loop animation'}
                onClick={() => setPaused(!paused)}
              >
                {paused ? (
                  <Play size={13} aria-hidden="true" />
                ) : (
                  <Pause size={13} aria-hidden="true" />
                )}
                <span>{paused ? 'Play' : 'Pause'}</span>
              </button>
            </div>
          </div>

          <div
            id={READOUT_ID}
            className="embodied-loop-readout"
            aria-live="polite"
            aria-atomic="true"
          >
            <div className="embodied-loop-readout-meta">
              <span>STAGE 0{active.index} / 06</span>
              <span className={`embodied-loop-tag embodied-loop-tag-${active.maturity}`}>
                {tagLabel(active.maturity)}
              </span>
            </div>
            <p className="embodied-loop-stage-name">{active.label}</p>
            <h3 className="lp-display">{active.headline}</h3>
            <p className="embodied-loop-stage-summary">{active.summary}</p>
            <ul className="embodied-loop-evidence">
              {active.bullets.map((bullet) => (
                <li key={bullet}>{bullet}</li>
              ))}
            </ul>
            {link.kind === 'doc' ? (
              <Link className="embodied-loop-link" to={link.to}>
                {link.label}
                <ArrowUpRight size={17} aria-hidden="true" />
              </Link>
            ) : (
              <a
                className="embodied-loop-link"
                href={link.href}
                onClick={(event) => scrollToSection(event, link.href)}
              >
                {link.label}
                <ArrowUpRight size={17} aria-hidden="true" />
              </a>
            )}
          </div>
        </div>

        <p className="embodied-loop-disclosure">
          One connected lifecycle. Different levels of readiness. <strong>Live</strong> means real
          hardware or real data; <strong>Sim</strong> means simulation only; <strong>Gated</strong>{' '}
          means a safety interlock still stands between the workflow and a real robot. The animation
          illustrates the lifecycle; it is not live telemetry.
        </p>
      </div>
    </section>
  );
});

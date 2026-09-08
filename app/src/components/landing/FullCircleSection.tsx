/**
 * @file FullCircleSection.tsx
 * @description The Embodied Loop: an interactive six-stage Physical AI lifecycle.
 * @feature landing
 */

import { memo, useState, type CSSProperties } from 'react';
import { ArrowRight, ArrowUpRight, Pause, Play } from 'lucide-react';
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
    headline: 'Your data, your model.',
    summary: 'Fine-tune on your own data without leaving the LeRobot format.',
    bullets: [
      'Your datasets stay in the open LeRobot format and sync with HuggingFace both ways — bring them in, take them out again.',
      'Six base models to choose from, with different levels of readiness. SmolVLA has completed the simulation workflow; GR00T N1.7 trains natively.',
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
    headline: 'Provable, not asserted.',
    summary: 'Record-keeping a regulator can check, and erasure that reaches the robot.',
    bullets: [
      'An audit trail that cannot be edited quietly — alter one entry and the check fails and names it (EU AI Act Art. 12).',
      'Records of processing, a self-service portal covering all seven kinds of data-subject request, legal holds and retention schedules.',
      'A deletion request reaches the robots too: it wipes what they remember, and tells you which ones were switched off rather than counting them as done.',
    ],
  },
];

const STAGE_LINKS: Record<string, { href: string; label: string }> = {
  collect: { href: '#data', label: 'Explore the data engine' },
  train: { href: '#models', label: 'Explore model readiness' },
  deploy: { href: '#safety', label: 'Explore the deployment gates' },
  evaluate: { href: '#safety', label: 'See the simulation evidence' },
  operate: { href: '#safety', label: 'Explore the safety layers' },
  comply: { href: '#sovereignty', label: 'Explore ownership and control' },
};

const READOUT_ID = 'fullcircle-readout';

function tagLabel(maturity: Maturity): string {
  return maturity === 'live' ? 'Live' : maturity === 'gated' ? 'Gated' : 'Sim';
}

/** Clockwise from twelve o'clock; the final stage closes back into Collect. */
export function stagePosition(index: number): { x: number; y: number } {
  const angle = ((index - 1) / STAGES.length) * Math.PI * 2 - Math.PI / 2;
  return { x: 50 + Math.cos(angle) * 37, y: 50 + Math.sin(angle) * 37 };
}

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
              <svg className="embodied-loop-paths" viewBox="0 0 600 600" aria-hidden="true">
                <defs>
                  <linearGradient id="embodiedLoopGradient" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#98f2e3" />
                    <stop offset="50%" stopColor="#8eb7ff" />
                    <stop offset="100%" stopColor="#c3aaff" />
                  </linearGradient>
                </defs>
                <circle cx="300" cy="300" r="270" className="embodied-loop-outer" />
                <circle
                  cx="300"
                  cy="300"
                  r="222"
                  stroke="url(#embodiedLoopGradient)"
                  strokeOpacity=".45"
                  strokeWidth="1.5"
                  fill="none"
                />
                <circle cx="300" cy="300" r="196" className="embodied-loop-inner" />
                <circle
                  cx="300"
                  cy="300"
                  r="222"
                  className="embodied-loop-signal"
                  pathLength="1000"
                  transform="rotate(-90 300 300)"
                />
                {STAGES.map((stage) => {
                  const angle = ((stage.index - 0.5) / 6) * 360;
                  return (
                    <path
                      key={stage.key}
                      d="m 295 78 7 0 -5 -5 m 5 5 -5 5"
                      transform={`rotate(${angle} 300 300)`}
                      stroke="#b8c7d9"
                      strokeWidth="1.5"
                      fill="none"
                    />
                  );
                })}
              </svg>
              <div className="embodied-loop-core" aria-hidden="true">
                <span className="embodied-loop-core-symbol">∞</span>
                <span>EXPERIENCE</span>
                <span className="embodied-loop-core-divider">↕</span>
                <span>INTELLIGENCE</span>
              </div>
              {STAGES.map((stage) => {
                const point = stagePosition(stage.index);
                return (
                  <button
                    key={stage.key}
                    type="button"
                    className="embodied-loop-node"
                    style={
                      { '--node-x': `${point.x}%`, '--node-y': `${point.y}%` } as CSSProperties
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
            <a
              className="embodied-loop-link"
              href={link.href}
              onClick={(event) => scrollToSection(event, link.href)}
            >
              {link.label}
              <ArrowUpRight size={17} aria-hidden="true" />
            </a>
          </div>
        </div>

        <div className="embodied-loop-return">
          <span>THE RETURN PATH</span>
          <p>What happens in the world becomes what you teach next.</p>
          <ArrowRight size={24} aria-hidden="true" />
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

/**
 * @file PlatformSection.tsx
 * @description Introduces NeoDEM as a shared home for Physical AI and its expert-led team.
 * @feature landing
 */

import { memo } from 'react';
import { ArrowDown, ArrowUpRight, Blocks, Cpu, Database, Radio } from 'lucide-react';
import { scrollToSection } from './scrollToSection';
import './platform.css';

const CAPABILITIES = [
  { label: 'Your data', icon: Database },
  { label: 'Your models', icon: Cpu },
  { label: 'Your workflows', icon: Blocks },
  { label: 'Your fleet', icon: Radio },
];

export const PlatformSection = memo(function PlatformSection() {
  return (
    <section
      id="platform"
      className="platform-section lp-anchor"
      aria-labelledby="platform-heading"
    >
      <div className="lp-container">
        <p className="platform-eyebrow">
          <span /> MEET NEODEM
        </p>
        <div className="platform-intro">
          <h2 id="platform-heading" className="lp-display">
            A home for
            <br />
            <span>Physical AI.</span>
          </h2>
          <div className="platform-definition">
            <p className="platform-lead">Big ideas deserve a life beyond the lab.</p>
            <p>
              NeoDEM is an open, all-in-one platform for building, deploying and managing Physical
              AI. Bring your data, models and machines into one workspace — and turn what happens in
              the real world into what gets better next.
            </p>
            <a href="#circle" onClick={(event) => scrollToSection(event, '#circle')}>
              Discover how it connects <ArrowDown size={17} aria-hidden="true" />
            </a>
          </div>
        </div>

        <div
          className="platform-blueprint"
          role="img"
          aria-label="Platform concept: your data, models, workflows and fleet connect through NeoDEM, a shared workspace for humanoids, drones, wheeled robots and quadrupeds. Integration readiness varies by hardware."
        >
          <div className="platform-blueprint-top" aria-hidden="true">
            <span>ONE WORKSPACE. SHARED CONTEXT.</span>
            <span>PLATFORM CONCEPT / 01</span>
          </div>
          <div className="platform-inputs" aria-hidden="true">
            {CAPABILITIES.map(({ label, icon: Icon }) => (
              <div className="platform-input" key={label}>
                <Icon size={22} strokeWidth={1.3} />
                <span>{label}</span>
              </div>
            ))}
          </div>
          <div className="platform-connections" aria-hidden="true">
            <svg viewBox="0 0 1000 100" preserveAspectRatio="none">
              <path d="M125 0 V25 Q125 50 150 50 H475 Q500 50 500 75 V100 M375 0 V25 Q375 50 400 50 H500 M625 0 V25 Q625 50 600 50 H500 M875 0 V25 Q875 50 850 50 H525 Q500 50 500 75" />
            </svg>
            <i />
            <i />
            <i />
            <i />
          </div>
          <div className="platform-core" aria-hidden="true">
            <span className="platform-core-symbol">
              <Blocks size={32} strokeWidth={1.2} />
            </span>
            <strong className="lp-display">NeoDEM</strong>
            <span className="platform-core-caption">
              One place to build.
              <br />
              One place to orchestrate.
            </span>
          </div>
          <div className="platform-outlet" aria-hidden="true" />
          <div className="platform-embodiments" aria-hidden="true">
            <span>Different bodies. Shared intelligence.</span>
            <p>
              Humanoids <b>·</b> Drones <b>·</b> Wheeled robots <b>·</b> Quadrupeds{' '}
              <small>(robot dogs)</small>
            </p>
          </div>
          <p className="platform-readiness" aria-hidden="true">
            A shared architecture. Integration readiness varies by hardware.
          </p>
        </div>

        <div className="platform-team">
          <div>
            <p className="platform-eyebrow">THE PEOPLE & AGENTS BEHIND IT</p>
            <h3 className="lp-display">
              Agentic by design.
              <br />
              Expert-led by choice.
            </h3>
          </div>
          <div className="platform-team-copy">
            <p>
              Maintained by a fleet of AI agents, guided by experts in cloud infrastructure, app
              development, robotics and AI. We bring these disciplines together to turn ambitious
              ideas into a better home for Physical AI.
            </p>
            <a href="#circle" onClick={(event) => scrollToSection(event, '#circle')}>
              Meet the Embodied Loop <ArrowUpRight size={18} aria-hidden="true" />
            </a>
          </div>
        </div>
      </div>
    </section>
  );
});

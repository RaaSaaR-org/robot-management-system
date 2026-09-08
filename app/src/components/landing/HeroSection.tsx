/**
 * @file HeroSection.tsx
 * @description Embodiment-independent Physical AI hero and interactive intelligence field.
 * @feature landing
 */
import { memo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUpRight, Pause, Play } from 'lucide-react';
import { useBrand } from '@/brand';
import { scrollToSection } from './scrollToSection';
import './hero.css';

const EMBODIMENTS = [
  {
    name: 'Drones',
    verb: 'Above the ground.',
    detail: 'Aerial robots',
    path: 'M-22-13L22 13M-22 13L22-13M-9-7H9V7H-9Z',
    rotors: true,
  },
  {
    name: 'Wheeled robots',
    verb: 'Across the floor.',
    detail: 'Mobile ground robots',
    path: 'M-24 8V-12L-13-20H13L24-12V8ZM-17-12H17M-28 9H28M-20 9V19H-10V9M10 9V19H20V9M-4-20V-28H4',
  },
  {
    name: 'Quadrupeds',
    verb: 'Beyond flat terrain.',
    detail: 'Four-legged robots (robot dogs)',
    path: 'M-23-12H16L26-5V3H-23ZM-19 3L-25 17-17 26M-9 3L-4 17-10 26M12 3L7 17 15 26M21 3L27 17 21 26M-23-9L-30-17',
  },
  {
    name: 'Humanoids',
    verb: 'In human spaces.',
    detail: 'Robots with a human-like form',
    path: 'M-7-24V-14H7V-24ZM-13-7H13L9 9H-9ZM-13-5L-23 12M13-5L23 12M-7 9L-11 28M7 9L11 28',
  },
] as const;

function EmbodimentGlyph({ index, x = 0, y = 0 }: { index: number; x?: number; y?: number }) {
  const item = EMBODIMENTS[index];
  return (
    <g
      transform={`translate(${x} ${y})`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={item.path} />
      {'rotors' in item &&
        [
          [-25, -15],
          [25, 15],
          [-25, 15],
          [25, -15],
        ].map(([cx, cy]) => <ellipse key={`${cx}-${cy}`} cx={cx} cy={cy} rx="12" ry="5" />)}
    </g>
  );
}

export const HeroSection = memo(function HeroSection() {
  const brand = useBrand();
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  return (
    <section
      className={`field-hero${paused ? ' field-paused' : ''}`}
      aria-labelledby="hero-heading"
    >
      <div className="field-grid" aria-hidden="true" />
      <div className="lp-container field-content">
        <p className="field-kicker">
          <span /> {brand.name} / THE OPEN PHYSICAL AI PLATFORM
        </p>
        <h1 id="hero-heading">
          Intelligence.
          <br />
          <em>Beyond the screen.</em>
        </h1>
        <p className="field-lede">
          Different bodies. One continuous loop.
          <br />
          Turn robot experience into intelligence — and bring it back into the world.
        </p>
        <div className="field-actions">
          <Link to="/dashboard" className="field-primary">
            Explore the platform <ArrowUpRight size={18} />
          </Link>
          <a href="#circle" onClick={(event) => scrollToSection(event, '#circle')}>
            Discover the Embodied Loop <ArrowDown size={16} />
          </a>
        </div>
        <div className="intelligence-field">
          <div className="field-caption">
            <span>ONE PLATFORM. MANY FORMS.</span>
            <span>CONCEPT / PHYSICAL AI</span>
          </div>
          <svg className="field-orbit" viewBox="0 0 1100 420" fill="none" aria-hidden="true">
            <defs>
              <radialGradient id="field-aura">
                <stop stopColor="#83e8da" stopOpacity=".28" />
                <stop offset="1" stopColor="#83e8da" stopOpacity="0" />
              </radialGradient>
              <linearGradient id="field-spectrum">
                <stop stopColor="#658aff" />
                <stop offset=".5" stopColor="#a2f8e2" />
                <stop offset="1" stopColor="#a092ff" />
              </linearGradient>
            </defs>
            <ellipse cx="550" cy="215" rx="380" ry="205" fill="url(#field-aura)" />
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
              <ellipse
                key={i}
                cx="550"
                cy="215"
                rx={310 + i * 12}
                ry={56 + i * 9}
                transform={`rotate(${-28 + i * 8} 550 215)`}
                stroke="url(#field-spectrum)"
                strokeOpacity={0.16 + i * 0.035}
              />
            ))}
            <g className="field-stream">
              <ellipse
                cx="550"
                cy="215"
                rx="390"
                ry="118"
                stroke="#b9ffeb"
                strokeWidth="2"
                strokeDasharray="2 80 130 1800"
                transform="rotate(-12 550 215)"
              />
            </g>
            <g className="field-stream field-stream-reverse">
              <ellipse
                cx="550"
                cy="215"
                rx="360"
                ry="125"
                stroke="#a695ff"
                strokeWidth="2"
                strokeDasharray="100 1800"
                transform="rotate(18 550 215)"
              />
            </g>
            {[
              [190, 170],
              [360, 315],
              [748, 95],
              [920, 257],
            ].map(([x, y], i) => (
              <g key={i} className={active === i ? 'field-node field-node-active' : 'field-node'}>
                <path
                  d={`M${x} ${y}L550 215`}
                  stroke="currentColor"
                  strokeDasharray="3 7"
                  opacity=".35"
                />
                <circle cx={x} cy={y} r="43" fill="#0a1522" stroke="currentColor" />
                <EmbodimentGlyph index={i} x={x} y={y} />
              </g>
            ))}
            <circle cx="550" cy="215" r="72" fill="#09131f" stroke="#9deed9" strokeOpacity=".4" />
            <circle cx="550" cy="215" r="63" stroke="#a2f8e2" strokeOpacity=".12" />
            <g transform="translate(550 208) scale(1.2)" className="field-center-glyph">
              <EmbodimentGlyph index={active} />
            </g>
            <text
              x="550"
              y="260"
              fill="#c2e5e1"
              textAnchor="middle"
              fontSize="8"
              fontFamily="monospace"
              letterSpacing="2"
            >
              EMBODIED AI
            </text>
          </svg>
          <div className="field-selection" id="field-selection" aria-live="polite">
            <strong>{EMBODIMENTS[active].verb}</strong>
            <span>{EMBODIMENTS[active].detail}</span>
          </div>
          <div className="field-controls">
            <div className="field-embodiments" role="group" aria-label="Explore robot forms">
              {EMBODIMENTS.map((item, index) => (
                <button
                  key={item.name}
                  type="button"
                  aria-pressed={active === index}
                  aria-controls="field-selection"
                  onClick={() => setActive(index)}
                >
                  <span>0{index + 1}</span>
                  {item.name}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="field-pause"
              onClick={() => setPaused(!paused)}
              aria-label={paused ? 'Play hero animation' : 'Pause hero animation'}
            >
              {paused ? <Play size={16} /> : <Pause size={16} />}
            </button>
          </div>
        </div>
        <div className="field-footnote">
          <span>OPEN SOURCE. YOUR MODELS. YOUR HARDWARE. YOUR CONTROL.</span>
          <span>Hardware-agnostic architecture. Integration readiness varies by robot.</span>
        </div>
      </div>
    </section>
  );
});

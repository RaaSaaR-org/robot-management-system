/**
 * @file HeroSection.tsx
 * @description Interactive Physical AI hero with an illustrative humanoid mission scene.
 * @feature landing
 */

import { memo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUpRight, MoveUpRight, Pause, Play } from 'lucide-react';
import { useBrand } from '@/brand';
import { scrollToSection } from './scrollToSection';
import './hero.css';

const STAGES = [
  {
    name: 'Teach',
    eyebrow: '01 / FROM HUMAN TO ROBOT',
    title: 'Your expertise. Its next skill.',
    description: 'Capture demonstrations and turn real movement into training data.',
    status: 'Demonstration → Dataset',
    detail: 'Collect',
    target: '#data',
  },
  {
    name: 'Deploy',
    eyebrow: '02 / FROM MODEL TO MOVEMENT',
    title: 'Bring the model into the world.',
    description: 'Manage policies, evaluate in simulation, and deploy with safety gates.',
    status: 'Model → Robot',
    detail: 'Deploy',
    target: '#circle',
  },
  {
    name: 'Improve',
    eyebrow: '03 / FROM EXPERIENCE TO INTELLIGENCE',
    title: 'Every run is a new beginning.',
    description: 'Inspect what happened. Bring the evidence back into the next training cycle.',
    status: 'Fleet → Feedback',
    detail: 'Evaluate',
    target: '#circle',
  },
] as const;

/** Decorative vector concept, deliberately not presented as product telemetry. */
const RobotScene = memo(function RobotScene({ stage }: { stage: number }) {
  return (
    <svg className="mission-robot" viewBox="0 0 640 720" fill="none" aria-hidden="true">
      <defs>
        <linearGradient
          id="robot-shell"
          x1="190"
          y1="100"
          x2="430"
          y2="470"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#f5f7fb" />
          <stop offset=".3" stopColor="#aebbc9" />
          <stop offset=".55" stopColor="#e2e8ef" />
          <stop offset="1" stopColor="#53667a" />
        </linearGradient>
        <linearGradient id="robot-edge">
          <stop stopColor="#233244" />
          <stop offset=".5" stopColor="#5c6f84" />
          <stop offset="1" stopColor="#172333" />
        </linearGradient>
        <linearGradient id="robot-visor" x2="0" y2="1">
          <stop stopColor="#253d50" />
          <stop offset="1" stopColor="#070e19" />
        </linearGradient>
        <radialGradient id="robot-halo">
          <stop stopColor="currentColor" stopOpacity=".18" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </radialGradient>
        <pattern id="mission-grid" width="36" height="36" patternUnits="userSpaceOnUse">
          <path d="M36 0H0V36" stroke="#a0b8ce" strokeOpacity=".09" />
        </pattern>
      </defs>
      <circle cx="330" cy="330" r="290" fill="url(#robot-halo)" />
      <path
        d="M20 580L320 420 620 580 320 740Z"
        fill="url(#mission-grid)"
        stroke="#8ba1b5"
        strokeOpacity=".14"
      />
      <g className="mission-orbits" stroke="currentColor">
        <ellipse cx="322" cy="590" rx="231" ry="76" strokeOpacity=".16" />
        <ellipse cx="322" cy="590" rx="177" ry="58" strokeOpacity=".3" strokeDasharray="3 9" />
        <ellipse cx="322" cy="590" rx="122" ry="40" strokeOpacity=".5" />
        <path d="M91 590h28m406 0h28M322 505v18m0 135v18" strokeOpacity=".6" />
      </g>
      <ellipse cx="320" cy="600" rx="98" ry="24" fill="#000" opacity=".5" />
      <g className="mission-body" stroke="#0d1928" strokeWidth="2">
        {/* Legs and exposed knee actuators. */}
        <path d="M271 372L312 378 306 467 269 465 258 408Z" fill="url(#robot-shell)" />
        <path d="M331 378L371 372 383 409 373 465 336 467Z" fill="url(#robot-shell)" />
        <circle cx="285" cy="474" r="22" fill="url(#robot-edge)" />
        <circle cx="355" cy="474" r="22" fill="url(#robot-edge)" />
        <circle cx="285" cy="474" r="11" stroke="#7d91a5" />
        <circle cx="355" cy="474" r="11" stroke="#7d91a5" />
        <path d="M263 486L306 490 300 568 269 569 257 518Z" fill="url(#robot-shell)" />
        <path d="M336 490L378 486 384 518 371 569 340 568Z" fill="url(#robot-shell)" />
        <path d="M267 565L301 565 303 597 248 599 244 586Z" fill="url(#robot-edge)" />
        <path d="M339 565L372 565 394 587 390 599 336 597Z" fill="url(#robot-edge)" />
        <path d="M250 591h44m50 0h42" stroke="#b6c4d4" strokeWidth="3" />
        {/* Pelvis, waist and torso. */}
        <path
          d="M263 337Q320 320 378 337L369 392 338 409 319 390 302 408 270 391Z"
          fill="url(#robot-edge)"
        />
        <path d="M278 317H362V349H278Z" fill="#111e2c" />
        <path d="M285 325h70m-70 9h70" stroke="#6e7e8d" />
        <path
          d="M257 195L289 182H350L383 195 375 266 354 321Q320 334 283 321L265 269Z"
          fill="url(#robot-shell)"
        />
        <path d="M269 208L296 196H345L370 208 357 254Q320 270 283 254Z" fill="url(#robot-edge)" />
        <path d="M297 219H344" stroke="currentColor" strokeWidth="3" />
        <path d="M299 285h42m-45 8h48m-43 8h38" stroke="#657a90" strokeWidth="3" />
        <path d="M277 268l9 39m78-39-9 39" stroke="#f4f8fc" strokeOpacity=".55" />
        {/* Shoulders and arms. */}
        <circle cx="250" cy="218" r="27" fill="url(#robot-edge)" />
        <circle cx="391" cy="218" r="27" fill="url(#robot-edge)" />
        <path d="M226 217Q242 201 260 216L255 282 228 295 216 279Z" fill="url(#robot-shell)" />
        <path d="M382 215Q400 201 415 218L425 279 413 295 385 282Z" fill="url(#robot-shell)" />
        <circle cx="237" cy="297" r="18" fill="url(#robot-edge)" />
        <circle cx="404" cy="297" r="18" fill="url(#robot-edge)" />
        <path d="M220 308L250 309 244 360 225 377 212 365Z" fill="url(#robot-shell)" />
        <path d="M391 309L421 308 430 365 416 377 397 360Z" fill="url(#robot-shell)" />
        <path d="M218 373L241 373 247 404 239 421 216 413 210 391Z" fill="url(#robot-edge)" />
        <path d="M400 373L423 373 431 391 425 413 402 421 394 404Z" fill="url(#robot-edge)" />
        <path d="M220 389l3 19m5-21 3 23m179-23-3 23m11-21-3 19" stroke="#879aaf" />
        {/* Head, inset visor and neck. */}
        <path d="M301 159H340V188H301Z" fill="url(#robot-edge)" />
        <path
          d="M281 110Q281 86 307 82H334Q361 87 361 111L355 156 341 171H300L285 156Z"
          fill="url(#robot-shell)"
        />
        <path d="M290 111Q319 101 353 111L349 145Q321 156 294 145Z" fill="url(#robot-visor)" />
        <path d="M300 125H341" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        <path d="M305 160h30" stroke="#5d7184" />
      </g>
      <g className="mission-scan" stroke="currentColor" strokeWidth="1">
        <path d="M174 250H464" strokeOpacity=".8" />
        <path d="M174 240v20m290-20v20" />
        <rect
          x="175"
          y="251"
          width="288"
          height="45"
          fill="currentColor"
          fillOpacity=".035"
          stroke="none"
        />
      </g>
      <g stroke="currentColor" strokeOpacity=".65">
        <path
          d={
            stage === 0
              ? 'M341 125H445L481 89H571'
              : stage === 1
                ? 'M345 220H445L481 184H571'
                : 'M355 474H440L482 432H571'
          }
        />
        <circle
          cx={stage === 0 ? 341 : stage === 1 ? 345 : 355}
          cy={stage === 0 ? 125 : stage === 1 ? 220 : 474}
          r="5"
          fill="#0b1723"
        />
        <path d="M270 347H181L145 383H67" />
        <circle cx="270" cy="347" r="4" fill="#0b1723" />
      </g>
      <g fill="#9fafc1" fontFamily="monospace" fontSize="9" letterSpacing="1.5">
        <text x="70" y="400">
          HUMANOID / CONCEPT
        </text>
        <text x="485" y={stage === 0 ? 80 : stage === 1 ? 175 : 423}>
          {stage === 0 ? 'PERCEPTION' : stage === 1 ? 'POLICY' : 'FEEDBACK'}
        </text>
        <text x="279" y="667">
          PHYSICAL AI
        </text>
      </g>
    </svg>
  );
});

export const HeroSection = memo(function HeroSection() {
  const brand = useBrand();
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const stage = STAGES[active];

  return (
    <section
      className={`mission-hero mission-stage-${active}${paused ? ' mission-paused' : ''}`}
      aria-labelledby="hero-heading"
    >
      <div className="mission-noise" aria-hidden="true" />
      <div className="lp-container mission-layout">
        <div className="mission-copy">
          <p className="mission-kicker">
            <span /> {brand.name} / THE OPEN PHYSICAL AI PLATFORM
          </p>
          <h1 id="hero-heading">
            Give intelligence
            <br />a <em>body.</em>
          </h1>
          <p className="mission-lede">
            From the first demonstration to a working fleet.
            <br className="hidden sm:block" /> Teach, deploy, and improve your robots in one place.
          </p>
          <div className="mission-actions">
            <Link to="/dashboard" className="mission-primary">
              Explore the platform <ArrowUpRight size={18} />
            </Link>
            <a
              href="#circle"
              onClick={(event) => scrollToSection(event, '#circle')}
              className="mission-secondary"
            >
              See how it works <ArrowDown size={16} />
            </a>
          </div>
          <p className="mission-ownership">
            Open source. Your models. Your hardware. Your control.
          </p>
        </div>
        <div className="mission-visual">
          <div className="mission-scene-label">
            <span className="mission-cross">+</span> INTELLIGENCE, EMBODIED <span>FIG. 01</span>
          </div>
          <RobotScene stage={active} />
          <div className="mission-scene-footer">
            <span>ILLUSTRATIVE WORKFLOW · NO LIVE TELEMETRY</span>
            <button
              type="button"
              onClick={() => setPaused(!paused)}
              aria-label={paused ? 'Play hero animation' : 'Pause hero animation'}
            >
              {paused ? <Play size={14} /> : <Pause size={14} />}
            </button>
          </div>
        </div>
        <div className="mission-workflow">
          <div className="mission-selectors" role="group" aria-label="Explore the robot lifecycle">
            {STAGES.map((item, index) => (
              <button
                key={item.name}
                type="button"
                aria-pressed={active === index}
                aria-controls="mission-stage-description"
                onClick={() => setActive(index)}
              >
                <span>0{index + 1}</span>
                {item.name}
                <MoveUpRight size={17} />
              </button>
            ))}
          </div>
          <div id="mission-stage-description" className="mission-description" aria-live="polite">
            <div>
              <p className="mission-eyebrow">{stage.eyebrow}</p>
              <h2>{stage.title}</h2>
              <p>{stage.description}</p>
            </div>
            <a
              href={stage.target}
              onClick={(event) => scrollToSection(event, stage.target)}
              className="mission-flow-link"
            >
              <span>{stage.status}</span>
              <ArrowUpRight size={22} />
              <span className="sr-only">Explore {stage.detail}</span>
            </a>
          </div>
        </div>
      </div>
      <div className="mission-bottom">
        <span>BUILT FOR THE ENTIRE ROBOT LIFECYCLE</span>
        <span>SCROLL TO EXPLORE ↓</span>
      </div>
    </section>
  );
});

/**
 * @file HeroSection.tsx
 * @description Landing hero — the thesis, next to the belief readout.
 * @feature landing
 */

import { Link } from 'react-router-dom';
import { useBrand } from '@/brand';
import { BeliefReadout } from './BeliefReadout';

const GITHUB_URL = 'https://github.com/RaaSaaR-org/robot-management-system';

export function HeroSection() {
  const brand = useBrand();

  return (
    <section className="lp-section pt-28 lg:pt-36" aria-labelledby="hero-heading">
      <div className="lp-container">
        <div className="grid items-start gap-12 lg:grid-cols-[minmax(0,1fr)_28rem] lg:gap-16">
          <div>
            <p className="lp-key mb-6">
              {brand.name} · Open Physical AI platform
            </p>

            <h1 id="hero-heading" className="lp-display lp-h1">
              The robot tells you
              <br />
              what it doesn&rsquo;t know.
            </h1>

            <p className="lp-lede mt-7">
              Most robotics software reports success. {brand.name} reports its state — measured,
              estimated, or unknown — through every stage from first demonstration to a compliant
              production fleet. When a reading is missing, it says <em>unknown</em>. When a stop
              isn&rsquo;t acknowledged, it says <em>unconfirmed</em>. That is the whole product.
            </p>

            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link
                to="/dashboard"
                className="lp-btn-primary px-6 py-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
              >
                Open the dashboard
              </Link>
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="lp-btn-secondary px-6 py-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
              >
                Read the source
              </a>
            </div>

            {/* Three facts, stated as readings rather than badges. */}
            <dl className="mt-11 grid max-w-xl grid-cols-1 sm:grid-cols-3">
              {[
                { k: 'Runs on', v: 'Your hardware', note: 'local LLM, no cloud key' },
                { k: 'Focus', v: 'Unitree G1', note: 'G1 EDU + Dex3-1, 43 DOF' },
                { k: 'Datasets', v: 'LeRobot', note: 'v2.1 · v3.0 · HF Hub' },
              ].map((item, i) => (
                <div
                  key={item.k}
                  className={i === 0 ? 'py-3 sm:pr-5' : 'border-t py-3 sm:border-t-0 sm:border-l sm:px-5 sm:last:pr-0'}
                  style={{ borderColor: 'var(--border-color)' }}
                >
                  <dt className="lp-key">{item.k}</dt>
                  <dd className="mt-1.5">
                    <span className="lp-h3">{item.v}</span>
                    <span className="lp-note mt-1 block">{item.note}</span>
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="lg:pt-2">
            <BeliefReadout />
            <p className="lp-note mt-3">
              Replay of one logged run — the warehouse hall, 2 August 2026. A
              <code className="mx-1" style={{ fontFamily: 'var(--font-mono)' }}>
                walk forward 2 metres
              </code>
              aimed at keepout RACK-A, stopped 0.48 m clear of the rack face by the safety
              monitor. A second approach reproduced it at 0.49 m. In simulation, over the same
              LocoClient call path a real G1 would take.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

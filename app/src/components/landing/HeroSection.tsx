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
              {brand.name} · Self-hosted robotic cloud
            </p>

            {/* nowrap on the compound: left to itself the display face breaks
                it at a hyphen and the first line reads "The all-in-". */}
            <h1 id="hero-heading" className="lp-display lp-h1">
              The <span className="whitespace-nowrap">all-in-one</span>
              <br />
              Physical AI platform.
            </h1>

            <p className="lp-lede mt-7">
              Collect the demonstrations, train the model, ship it to the robot, measure what it
              did, run the fleet and prove it to a regulator. One full circle, in one system — your
              own robotic cloud, on hardware you own. Any VLA. Any world model.{' '}
              <span style={{ color: 'var(--text-primary)' }}>No vendor login.</span>
            </p>

            <p className="lp-body mt-5">
              And it is built to be believed. The robot reports its state as measured, estimated or
              unknown — when a reading is missing it says <em>unknown</em>, when a stop was never
              acknowledged it says <em>unconfirmed</em>. Every stage on this page carries the
              status it has actually reached.
            </p>

            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link
                to="/dashboard"
                className="lp-btn-primary px-6 py-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
              >
                Explore the live demo
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

            {/* Three facts, stated as readings rather than badges. Each one is
                a claim the page goes on to itemise — the loop, the model
                registry, and the self-hosting. */}
            <dl className="mt-11 grid max-w-xl grid-cols-1 sm:grid-cols-3">
              {[
                { k: 'Lifecycle', v: 'Full circle', note: 'six stages, one system' },
                { k: 'Models', v: 'VLA + WAM', note: 'GR00T · π0 · SmolVLA · Cosmos' },
                { k: 'Runs on', v: 'Your hardware', note: 'MIT · self-hosted · no account' },
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

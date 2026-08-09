/**
 * @file ProofSection.tsx
 * @description Landing proof section — a still of the shipped UI, captured from this repo.
 * @feature landing
 *
 * Previously this block led with three screen recordings and a 3-up of stills.
 * All of it was removed rather than dressed up:
 *
 *  - lifecycle-tour.webm records the PREVIOUS landing page, so a section arguing
 *    "this is the actual product" was showing a design that no longer exists.
 *  - collect-train.webm and operate-comply.webm land on demo-mode placeholder
 *    screens, and the capture harness hides the "Demo — Not Available" badge.
 *  - fleet-map.png and alerts.png predate TASK-147: old sidebar, old blue branding.
 *
 * What is left is the one capture that is both current and on-brand, with a
 * caption that names the build it came from. Training and Compliance are simply
 * not claimed here — they render as placeholders in demo mode, so there is no
 * honest capture of them to show.
 */

import { useBrand } from '@/brand';

const STILL = {
  file: 'dashboard.png',
  width: 1440,
  height: 900,
  title: 'Fleet dashboard',
  alt: 'Fleet dashboard screen: per-robot status tiles with live telemetry and a fleet-wide E-Stop control.',
} as const;

export function ProofSection() {
  const brand = useBrand();

  return (
    <section id="proof" className="lp-section lp-anchor" aria-labelledby="proof-heading">
      <div className="lp-container">
        <div className="lp-grid">
          <div className="lp-rail">
            <span className="lp-rail-name">Proof</span>
            <span className="lp-tag lp-tag-live">Live</span>
          </div>

          <div>
            <h2 id="proof-heading" className="lp-display lp-h2">
              This is the actual product.
            </h2>

            <p className="lp-lede mt-5">
              The {brand.name} fleet dashboard, screenshotted from the app in this repository.
              Not a mockup and not a rendered stand-in — it is the UI the code produces.
            </p>

            <figure className="mt-9">
              <div className="lp-panel overflow-hidden">
                <img
                  src={`${import.meta.env.BASE_URL}screenshots/${STILL.file}`}
                  alt={STILL.alt}
                  width={STILL.width}
                  height={STILL.height}
                  loading="lazy"
                  decoding="async"
                  className="block h-auto w-full"
                />
              </div>

              <figcaption className="mt-4">
                <span className="lp-value block">{STILL.title}</span>
                <span className="lp-key mt-2 block">
                  {STILL.width} × {STILL.height} · PNG
                </span>
                <span className="lp-note mt-3 block">
                  Captured from this repo running in demo mode (
                  <code style={{ fontFamily: 'var(--font-mono)' }}>VITE_DEMO_MODE=true</code>),
                  with seeded robots and generated telemetry. The robots and the numbers on
                  screen are demo data; the screens, the controls and the code paths behind them
                  are the ones that ship.
                </span>
              </figcaption>
            </figure>
          </div>
        </div>
      </div>
    </section>
  );
}

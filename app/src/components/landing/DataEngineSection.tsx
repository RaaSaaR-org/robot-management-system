/**
 * @file DataEngineSection.tsx
 * @description The data engine — every way an episode gets into the platform,
 *              and what happens to it once it is in.
 * @feature landing
 *
 * The old page had a "data flywheel" diagram that asserted a loop without
 * naming a single capture path. This states the paths instead, each with the
 * status it has reached, and it is the section stage 1 of the full circle
 * points at.
 *
 * Sources, checked: teleop/VR recording into LeRobot v3.0 chunked datasets;
 * the LiDAR scan → twin sidecar (validated on a 240k-point MID-360 capture);
 * world-model generators (CosmosSyntheticService); video → G1 retargeting
 * (GVHMR → GMR); HuggingFace Hub import/export; the marketplace's credit-
 * settled dataset purchases.
 */

import { useBrand } from '@/brand';

type Status = 'live' | 'sim';

interface Source {
  name: string;
  status: Status;
  /** Mono sub-label — the embodiment or format this path produces. */
  produces: string;
  note: string;
}

const SOURCES: readonly Source[] = [
  {
    name: 'Teleoperation & VR',
    status: 'sim',
    produces: 'G1 EDU + Dex3-1 · 43 joints',
    note: 'Drive the robot by hand and the session records itself into a training-ready dataset — no export, no conversion script. Proven in simulation; the path to real hardware is still gated.',
  },
  {
    name: 'LiDAR room scan',
    status: 'live',
    produces: 'digital twin · simulator-ready',
    note: 'Walk a scanner around the space and it comes back as a digital twin you can navigate and simulate in — proven on a real 240,000-point capture of our lab. The rooms and zones you draw on the twin become the places the robot is sent to by name.',
  },
  {
    name: 'World-model synthesis',
    status: 'live',
    produces: 'generated episodes · tagged synthetic',
    note: 'When the robots cannot make enough episodes, a world action model imagines them — and every one is labelled synthetic, so nothing on the record ever passes a dream off as a recording.',
  },
  {
    name: 'Video → motion',
    status: 'sim',
    produces: 'human footage → G1 motion',
    note: 'Ordinary video of a person working, turned into motion the G1 can perform and played back on the live 3D robot.',
  },
  {
    name: 'Hub & marketplace',
    status: 'live',
    produces: 'HuggingFace · contribution credits',
    note: 'Sync datasets with HuggingFace in both directions, or buy and sell them for contribution credits — the transfer either completes or it does not happen, and what you download is checksummed against what was sold.',
  },
];

/** The four steps every episode takes, whichever door it came in through. */
const PIPELINE: readonly { step: string; label: string; note: string }[] = [
  { step: '01', label: 'Capture', note: 'Driven, scanned, generated or imported' },
  { step: '02', label: 'Validate', note: 'Format, statistics and video checked' },
  { step: '03', label: 'Curate', note: 'Trim the takes, drop the failures' },
  { step: '04', label: 'Version', note: 'New revision, original intact' },
];

function statusTag(status: Status) {
  return status === 'live' ? 'lp-tag lp-tag-live' : 'lp-tag lp-tag-sim';
}

export function DataEngineSection() {
  const brand = useBrand();

  return (
    <section id="data" className="lp-section lp-anchor" aria-labelledby="data-heading">
      <div className="lp-container">
        <div className="lp-grid">
          <div className="lp-rail">
            <span className="lp-rail-name">Data engine</span>
            <span className="lp-tag lp-tag-live">Live</span>
          </div>

          <div>
            <h2 id="data-heading" className="lp-display lp-h2">
              Turn experience into intelligence.
            </h2>

            <p className="lp-lede mt-5">
              Bring demonstrations, room scans and generated episodes into {brand.name}.
              Check the quality, keep the useful takes and build a versioned dataset your next
              model can learn from. One open format, with a clear record of where the data came from.
            </p>

            {/* The pipeline, as four numbered stops. Numbered because this one
                genuinely is a sequence: nothing reaches a revision without
                passing validation first. */}
            <ol
              className="mt-10 grid gap-px overflow-hidden rounded-[10px] border sm:grid-cols-2 lg:grid-cols-4"
              style={{
                borderColor: 'var(--border-color)',
                backgroundColor: 'var(--border-color)',
              }}
            >
              {PIPELINE.map((item) => (
                <li
                  key={item.step}
                  className="p-4"
                  style={{ backgroundColor: 'var(--bg-secondary)' }}
                >
                  <span className="lp-key tabular-nums">{item.step}</span>
                  <p className="lp-h3 mt-1.5">{item.label}</p>
                  <p className="lp-note mt-1">{item.note}</p>
                </li>
              ))}
            </ol>

            <p className="lp-key mt-12">Five ways to build your dataset</p>

            <ul className="mt-3 border-b" role="list" style={{ borderColor: 'var(--border-color)' }}>
              {SOURCES.map((source) => (
                <li
                  key={source.name}
                  className="grid gap-x-8 gap-y-2 border-t py-5 lg:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]"
                  style={{ borderColor: 'var(--border-color)' }}
                >
                  <div>
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
                      <h3 className="lp-h3">{source.name}</h3>
                      <span className={`${statusTag(source.status)} shrink-0`}>
                        {source.status === 'live' ? 'Live' : 'Sim'}
                      </span>
                    </div>
                    <p className="lp-value mt-1.5" style={{ color: 'var(--text-secondary)' }}>
                      {source.produces}
                    </p>
                  </div>
                  <p className="lp-body text-[0.875rem]">{source.note}</p>
                </li>
              ))}
            </ul>

            {/* The mechanic that makes the rest of it trustworthy. */}
            <div
              className="lp-panel mt-11 p-5 sm:p-7"
              style={{
                borderLeftWidth: '3px',
                borderLeftColor: 'var(--color-signal-measured)',
              }}
            >
              <p className="lp-key normal-case tracking-normal">Curation</p>

              <h3 className="lp-h3 mt-2" style={{ fontSize: '1.25rem' }}>
                Improve the data. Keep the original.
              </h3>

              <p className="lp-body mt-3">
                Trim a shaky start or remove a failed grasp to create a <em>new version</em>.
                The original recording stays intact, statistics update and video is re-cut.
                Every trained model can be traced to the exact dataset version it learned from.
              </p>

              <p className="lp-body mt-3">
                Experiment freely, compare revisions and return to the source whenever you need to.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

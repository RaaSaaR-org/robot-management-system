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
    produces: 'G1 EDU + Dex3-1 · 43 DOF',
    note: 'Drive the robot by hand and the session records straight into a chunked LeRobot v3.0 dataset — no export step, no conversion script. Proven in simulation; the hardware path is gated.',
  },
  {
    name: 'LiDAR room scan',
    status: 'live',
    produces: 'point cloud · occupancy · mesh.glb',
    note: 'Walk a MID-360 around the space and a sidecar rebuilds it as a digital twin plus a usable MuJoCo scene. Validated on a real 240k-point capture of the lab. The twin’s zones become the named places the robot navigates by.',
  },
  {
    name: 'World-model synthesis',
    status: 'live',
    produces: 'LeRobot v2.1 · tagged synthetic',
    note: 'When the robots cannot make enough episodes, a world action model generates them — and every one is registered as synthetic, so nothing on the record pretends a dream was a recording.',
  },
  {
    name: 'Video → motion',
    status: 'sim',
    produces: 'retargeted G1 trajectories',
    note: 'Pose estimation on ordinary footage, retargeted onto the G1 skeleton and played back on the live 3D robot over a real transport.',
  },
  {
    name: 'Hub & marketplace',
    status: 'live',
    produces: 'HuggingFace · contribution credits',
    note: 'Sync datasets with the HuggingFace Hub in both directions, or buy and sell them for contribution credits — settled atomically, downloaded through a presigned URL with a real checksum.',
  },
];

/** The four steps every episode takes, whichever door it came in through. */
const PIPELINE: readonly { step: string; label: string; note: string }[] = [
  { step: '01', label: 'Capture', note: 'Teleop, scan, synthesis or Hub' },
  { step: '02', label: 'Validate', note: 'Schema, stats, video integrity' },
  { step: '03', label: 'Curate', note: 'Video-aware trim and delete' },
  { step: '04', label: 'Revision', note: 'New version, lineage kept' },
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
              Your fleet is the dataset.
            </h2>

            <p className="lp-lede mt-5">
              Data collection is not a phase you finish. Every demonstration someone teleoperates,
              every room a robot scans, every shift a fleet works — it all lands in the same
              versioned store, in the same open format, ready to train the next model.{' '}
              {brand.name} treats the collecting as the engine, not the paperwork before the
              interesting part.
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

            <p className="lp-key mt-12">Ways in</p>

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
                Editing a dataset never edits the dataset
              </h3>

              <p className="lp-body mt-3">
                Trimming a wobbly first second off forty episodes, or dropping the six where the
                gripper missed, produces a <em>new revision</em> with its lineage recorded — the
                source is left exactly as it was recorded. Statistics recompute, the video is cut
                frame-accurately rather than just re-indexed, and the model card can always name
                the revision it was trained on.
              </p>

              <p className="lp-body mt-3">
                That is what makes a data engine safe to run fast. You can throw away the wrong
                episodes at three in the morning and still prove, a year later, what the training
                set actually contained.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

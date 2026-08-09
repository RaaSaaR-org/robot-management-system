/**
 * @file ModelLayerSection.tsx
 * @description The model layer — VLA policies and world action models, each
 *              with the status it has actually reached, plus what "no vendor
 *              login" does and does not mean.
 * @feature landing
 *
 * Every row is checked against the repo, because a compatibility table is the
 * easiest thing on a marketing page to inflate:
 *
 *  - the six base models are the `BaseModels` tuple in server/src/types/vla.types.ts
 *  - SmolVLA Active / GR00T N1 Ready / pi0.5 Stub is the support table in
 *    docs/vla-integration-guide.md, which describes ../vla-server
 *  - both world-model generators, their embodiments and which one needs an HF
 *    PRO token come from server/src/services/CosmosSyntheticService.ts
 *  - the Cosmos 3 no-go verdict is server/curation/README.md
 *
 * "Registered" is its own status on purpose. Six models are selectable and
 * carried end to end by this platform; how far each one's trainer has been
 * exercised is a question about ../training-worker, and the footnote says so
 * rather than letting the tag imply an answer.
 */

import { useBrand } from '@/brand';

type Status = 'live' | 'ready' | 'registered' | 'stub' | 'ruled-out';

interface ModelRow {
  name: string;
  /** Who makes it — the reason this table is interesting at all. */
  origin: string;
  status: Status;
  note: string;
}

const POLICIES: readonly ModelRow[] = [
  {
    name: 'SmolVLA',
    origin: 'HuggingFace / LeRobot',
    status: 'live',
    note: 'Fine-tuned here, served here. Runs on a Mac, an NVIDIA GPU or an ordinary CPU — the whole train → serve → evaluate circle has been walked end to end on a Mac.',
  },
  {
    name: 'GR00T N1.7',
    origin: 'NVIDIA',
    status: 'ready',
    note: 'Trains natively, straight from the training wizard. The pick-and-place environment mirrors the workflow NVIDIA ships for it.',
  },
  {
    name: 'GR00T N1',
    origin: 'NVIDIA',
    status: 'ready',
    note: 'Served from your own NVIDIA box. The connection ships with the platform; you supply the GPU.',
  },
  {
    name: 'π0 · π0.6',
    origin: 'Physical Intelligence',
    status: 'registered',
    note: 'Selectable as the starting point for a training run.',
  },
  {
    name: 'OpenVLA',
    origin: 'Stanford',
    status: 'registered',
    note: 'Selectable as the starting point for a training run.',
  },
  {
    name: 'π0.5',
    origin: 'Physical Intelligence',
    status: 'stub',
    note: 'Scaffolded, but not yet connected to real weights. Listed because it is on the roadmap, tagged because it is not done.',
  },
];

const WORLD_MODELS: readonly ModelRow[] = [
  {
    name: 'GR00T-Dreams',
    origin: 'NVIDIA · Cosmos-Predict2-2B',
    status: 'live',
    note: 'Describe a task in words and it imagines the G1 and its hands doing it, then works backwards to the joint motion — within 0.08 rad of the real motion it was checked against. Lands as an ordinary dataset, tagged synthetic. No account needed.',
  },
  {
    name: 'Cosmos 3',
    origin: 'NVIDIA',
    status: 'live',
    note: 'Ask what happens next if the arm does this, and it generates the footage — landing as an ordinary dataset like any other. This one path does want a paid HuggingFace account.',
  },
  {
    name: 'Cosmos 3 as an evaluator',
    origin: 'Tested, then dropped',
    status: 'ruled-out',
    note: 'We tried it as a policy-ranking simulator. It is visually plausible and action-conditioned, and it still ranked a do-nothing policy wrong. Published as a no-go instead of quietly deleted.',
  },
];

const STATUS_TAG: Record<Status, { className: string; label: string }> = {
  live: { className: 'lp-tag lp-tag-live', label: 'Live' },
  ready: { className: 'lp-tag lp-tag-gated', label: 'Ready' },
  registered: { className: 'lp-tag lp-tag-sim', label: 'Registered' },
  stub: { className: 'lp-tag lp-tag-sim', label: 'Stub' },
  'ruled-out': { className: 'lp-tag lp-tag-stopped', label: 'Ruled out' },
};

interface ModelTableProps {
  /** Mono column header — what this class of model is for. */
  kicker: string;
  title: string;
  blurb: string;
  rows: readonly ModelRow[];
}

function ModelTable({ kicker, title, blurb, rows }: ModelTableProps) {
  return (
    <div>
      <p className="lp-key">{kicker}</p>
      <h3 className="lp-h3 mt-2" style={{ fontSize: '1.25rem' }}>
        {title}
      </h3>
      <p className="lp-body mt-2 text-[0.875rem]">{blurb}</p>

      <ul className="mt-6 border-b" role="list" style={{ borderColor: 'var(--border-color)' }}>
        {rows.map((row) => {
          const tag = STATUS_TAG[row.status];
          return (
            <li
              key={row.name}
              className="border-t py-4"
              style={{ borderColor: 'var(--border-color)' }}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1.5">
                <span
                  className="lp-value"
                  style={{ fontSize: '0.9375rem', fontWeight: 600 }}
                >
                  {row.name}
                </span>
                <span className={`${tag.className} shrink-0`}>{tag.label}</span>
              </div>
              <p className="lp-note mt-1">{row.origin}</p>
              <p className="lp-body mt-2 text-[0.8125rem]">{row.note}</p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function ModelLayerSection() {
  const brand = useBrand();

  return (
    <section id="models" className="lp-section lp-anchor" aria-labelledby="models-heading">
      <div className="lp-container">
        <div className="lp-grid">
          <div className="lp-rail">
            <span className="lp-rail-name">Models</span>
            <span className="lp-tag lp-tag-live">Open</span>
          </div>

          <div>
            <h2 id="models-heading" className="lp-display lp-h2">
              Any brain.
              <br />
              No vendor login.
            </h2>

            <p className="lp-lede mt-5">
              The model layer is a socket, not a supplier. Vision-language-action models and world
              action models plug into the same place, train on the same data and ship through the
              same staged rollout — so which brain you run stays a technical decision rather than a
              five-year commercial one. The weights are yours, and {brand.name} never asks a third
              party for permission to run one.
            </p>

            <div className="mt-12 grid gap-12 lg:grid-cols-2 lg:gap-x-14">
              <ModelTable
                kicker="VLA · the policy that acts"
                title="Vision-language-action"
                blurb="Sees the scene, reads the instruction, decides the next move. Six to choose from; two run the whole circle today."
                rows={POLICIES}
              />
              <ModelTable
                kicker="WAM · the model that imagines"
                title="World action models"
                blurb="Generates the experience instead of recording it. Show it a situation, tell it what the robot does, and it imagines what happens next — as training data, when a real robot cannot make enough of it."
                rows={WORLD_MODELS}
              />
            </div>

            {/* The claim, and the two places it has an asterisk. Putting the
                exceptions in the same panel is the point — a lock-in claim
                with the caveats on another page is a lock-in claim. */}
            <div
              className="lp-panel mt-12 p-5 sm:p-7"
              style={{
                borderLeftWidth: '3px',
                borderLeftColor: 'var(--color-signal-measured)',
              }}
            >
              <p className="lp-key normal-case tracking-normal">No vendor login</p>

              <h3 className="lp-h3 mt-2" style={{ fontSize: '1.25rem' }}>
                What that actually buys you
              </h3>

              <div className="mt-4 grid gap-x-10 gap-y-4 sm:grid-cols-2">
                <p className="lp-body text-[0.875rem]">
                  <span style={{ color: 'var(--text-primary)' }}>No account for the platform.</span>{' '}
                  MIT, self-hosted, no licence server, no seat count, nothing phoning home. Clone
                  it and it runs.
                </p>
                <p className="lp-body text-[0.875rem]">
                  <span style={{ color: 'var(--text-primary)' }}>No account for the reasoning.</span>{' '}
                  Point the platform at a model running in your own building and the language
                  understanding, the planning and the data suggestions all run there too.
                </p>
                <p className="lp-body text-[0.875rem]">
                  <span style={{ color: 'var(--text-primary)' }}>Open weights, open format.</span>{' '}
                  Datasets stay in the open LeRobot format, synced with HuggingFace both ways. Take
                  the data and the trained models and walk out — there is nothing proprietary to
                  convert from.
                </p>
                <p className="lp-body text-[0.875rem]">
                  <span style={{ color: 'var(--text-primary)' }}>Two honest exceptions.</span> The
                  Cosmos 3 generator runs on HuggingFace and wants a paid account there, and if you
                  pick a hosted AI provider instead of a local one you bring that vendor&rsquo;s
                  key. Neither is required to run the platform.
                </p>
              </div>
            </div>

            <p className="lp-note mt-6">
              Training and serving run on your own GPU machines rather than inside the platform, so
              how far a given model has been pushed depends partly on the hardware you point at it.
              The status here is what {brand.name} carries end to end — not a promise about someone
              else&rsquo;s GPU.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

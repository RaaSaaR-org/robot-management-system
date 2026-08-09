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
    note: 'Fine-tuned here, served here. Runs on Apple Silicon, CUDA or plain CPU — the full train → serve → evaluate circle has been walked on a Mac.',
  },
  {
    name: 'GR00T N1.7',
    origin: 'NVIDIA',
    status: 'ready',
    note: 'LeRobot-native trainer path (lerobot[groot]). Selectable in the training wizard; the apple-to-plate environment replicates NVIDIA’s own workflow.',
  },
  {
    name: 'GR00T N1',
    origin: 'NVIDIA',
    status: 'ready',
    note: 'Served over ZMQ to a PolicyServer on your own NVIDIA box. The adapter ships; it wants a GPU you supply.',
  },
  {
    name: 'π0 · π0.6',
    origin: 'Physical Intelligence',
    status: 'registered',
    note: 'In the base-model registry and selectable for a training job.',
  },
  {
    name: 'OpenVLA',
    origin: 'Stanford',
    status: 'registered',
    note: 'In the base-model registry and selectable for a training job.',
  },
  {
    name: 'π0.5',
    origin: 'Physical Intelligence',
    status: 'stub',
    note: 'The serving adapter exists as a stub and is not wired to weights. Listed because it is on the roadmap, tagged because it is not done.',
  },
];

const WORLD_MODELS: readonly ModelRow[] = [
  {
    name: 'GR00T-Dreams',
    origin: 'NVIDIA · Cosmos-Predict2-2B',
    status: 'live',
    note: 'Language-prompted neural trajectories for the G1 + Dex3, pseudo-labelled by an inverse dynamics model (holdout MAE 0.079 rad). Lands as a real LeRobot dataset, tagged synthetic. No token needed.',
  },
  {
    name: 'Cosmos 3',
    origin: 'NVIDIA',
    status: 'live',
    note: 'Action-conditioned forward-dynamics rollouts on the WidowX bridge embodiment, converted to a LeRobot v2.1 dataset and registered like any other. This one path does want a HuggingFace PRO token.',
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
              The model layer is an interface, not a supplier. Vision-language-action policies and
              world action models plug into the same registry, train on the same datasets and
              deploy through the same canary — so the model you pick stays a technical decision
              rather than a five-year commercial one. Weights are yours, checkpoints are files,
              and {brand.name} never asks a third party for permission to run one.
            </p>

            <div className="mt-12 grid gap-12 lg:grid-cols-2 lg:gap-x-14">
              <ModelTable
                kicker="VLA · the policy that acts"
                title="Vision-language-action"
                blurb="Sees the scene, reads the instruction, emits the next action chunk. Six base models are in the registry; two run end to end today."
                rows={POLICIES}
              />
              <ModelTable
                kicker="WAM · the model that imagines"
                title="World action models"
                blurb="Generates the experience instead of recording it — action-conditioned futures that become training data when a real robot cannot make enough of it."
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
                  Point the LLM provider at Ollama and command interpretation, orchestration and
                  curation suggestions all run on a model in your own building.
                </p>
                <p className="lp-body text-[0.875rem]">
                  <span style={{ color: 'var(--text-primary)' }}>Open weights, open format.</span>{' '}
                  Datasets are LeRobot v2.1 and v3.0 with Hub sync both ways. Take the data and the
                  checkpoints and walk out — there is no proprietary container to convert from.
                </p>
                <p className="lp-body text-[0.875rem]">
                  <span style={{ color: 'var(--text-primary)' }}>Two honest exceptions.</span> The
                  Cosmos 3 forward-dynamics generator runs on a HuggingFace ZeroGPU Space and wants
                  a PRO token, and if you choose a hosted LLM instead of Ollama you bring that
                  vendor&rsquo;s key. Neither is required to run the platform.
                </p>
              </div>
            </div>

            <p className="lp-note mt-6">
              Training executes in a sibling worker and serving in a sibling VLA server, so how far
              each base model&rsquo;s trainer has been exercised is a question about those repos.
              The status here is what this platform carries, not a promise about someone
              else&rsquo;s GPU.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

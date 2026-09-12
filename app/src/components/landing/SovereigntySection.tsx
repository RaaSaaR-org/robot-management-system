/**
 * @file SovereigntySection.tsx
 * @description Landing section — local inference and the paper trail: the
 *              platform runs on your own hardware and can prove what it did.
 * @feature landing
 *
 * Every claim here is code-backed:
 *  - LLM_PROVIDER=gemini|openrouter|ollama → server/src/services/llm/index.ts
 *  - hash-chain verify endpoint            → GET /api/compliance/verify
 *  - 7 GDPR request types                  → server/src/types/gdpr.types.ts
 *  - legal hold beats retention            → server/src/jobs/RetentionCleanupJob.ts
 *  - Art. 17 erasure reaches the fleet     → server/src/services/RobotMemoryErasureService.ts
 */

import { useBrand } from '@/brand';

interface RecordRow {
  /** The citation, printed verbatim — never softened. */
  cite: string;
  body: string;
}

/** The three AI providers, and where each one runs. Local is the lit one. */
const PROVIDERS: readonly { name: string; where: string; local: boolean }[] = [
  { name: 'Gemini', where: 'Cloud', local: false },
  { name: 'OpenRouter', where: 'Cloud', local: false },
  { name: 'Ollama', where: 'Your hardware', local: true },
];

const RECORDS: RecordRow[] = [
  {
    cite: 'Art. 12',
    body:
      'A tamper-evident audit trail. Run the check and it re-walks every entry and names any one that no longer matches.',
  },
  {
    cite: 'Annex IV',
    body: 'Technical documentation, generated in the AI Act Annex IV structure.',
  },
  {
    cite: 'Art. 14',
    body:
      'Human oversight: multi-step approvals, escalation, and a route to contest or intervene in a decision.',
  },
  {
    cite: 'Art. 30',
    body: 'GDPR records of processing — the RoPA, kept in the system that does the processing.',
  },
  {
    cite: 'Art. 15–22',
    body:
      'A self-service portal covering all 7 data-subject request types: access, rectification, erasure, restriction, portability, objection, and review of an automated decision.',
  },
  {
    cite: 'Retention',
    body:
      'Retention policies delete on a schedule. A legal hold takes those records out of the cleanup job’s reach until you lift it.',
  },
];

export function SovereigntySection() {
  const brand = useBrand();

  return (
    <section
      id="sovereignty"
      className="lp-section lp-anchor"
      aria-labelledby="sovereignty-heading"
    >
      <div className="lp-container">
        <div className="lp-grid">
          <div className="lp-rail">
            <span className="lp-rail-name">Sovereignty</span>
            <span className="lp-tag lp-tag-live">Live</span>
          </div>

          <div>
            <h2 id="sovereignty-heading" className="lp-display lp-h2">
              Your intelligence.
              <br />
              On your terms.
            </h2>

            <p className="lp-lede mt-5">
              Run the platform&rsquo;s AI on your own hardware with Ollama, or connect a cloud
              provider you choose. Keep decisions traceable with audit records, human approvals
              and tools for handling data rights.
            </p>

            {/* Asymmetric: the switch is narrow, the record is wide. */}
            <div className="mt-12 grid gap-11 lg:grid-cols-[minmax(0,21rem)_minmax(0,1fr)] lg:gap-14">
              {/* ---- 1. Where the AI runs ---------------------------------- */}
              <div>
                <h3 className="lp-h3">Where the AI runs</h3>

                {/* The switch, drawn as a switch. It used to print the
                    environment variable verbatim, which made the whole
                    sovereignty claim read as a config note — the point is that
                    it is one setting, not which setting it happens to be. */}
                <div
                  className="lp-panel-inset mt-4 flex overflow-hidden"
                  role="img"
                  aria-label="AI provider setting: Gemini or OpenRouter in the cloud, or Ollama on your own hardware — currently Ollama"
                >
                  {PROVIDERS.map((provider, i) => (
                    <div
                      key={provider.name}
                      className={`flex-1 px-2 py-2.5 text-center ${i === 0 ? '' : 'border-l'}`}
                      style={{
                        borderColor: 'var(--border-color)',
                        backgroundColor: provider.local ? 'var(--bg-elevated)' : 'transparent',
                      }}
                    >
                      <span
                        className="block text-[0.8125rem]"
                        style={{
                          fontWeight: provider.local ? 600 : 400,
                          color: provider.local
                            ? 'var(--color-signal-measured)'
                            : 'var(--text-secondary)',
                        }}
                      >
                        {provider.name}
                      </span>
                      <span className="lp-note mt-1 block">{provider.where}</span>
                    </div>
                  ))}
                </div>

                <p className="lp-body mt-4 text-[0.875rem]">
                  Choose the local one and the whole {brand.name} server runs its AI on a model in
                  your own building: no cloud key, no data leaving the site. Understanding a spoken
                  command, planning a job and suggesting what to cut from a dataset all move
                  together — it is one switch, not three.
                </p>

                <p className="lp-body mt-3 text-[0.875rem]">
                  Local is not off the record. Whichever you pick, the model that made a decision
                  is named in the EU AI Act audit trail.
                </p>
              </div>

              {/* ---- 2. The paper trail ------------------------------------ */}
              <div>
                <h3 className="lp-h3">A record you can verify</h3>
                <p className="lp-body mt-3 text-[0.875rem]">
                  Implemented controls mapped to the requirements they support.
                </p>

                <dl
                  className="mt-5 border-b"
                  style={{ borderColor: 'var(--border-color)' }}
                >
                  {RECORDS.map((row) => (
                    <div
                      key={row.cite}
                      className="grid gap-x-5 gap-y-1 border-t py-3.5 sm:grid-cols-[6.5rem_minmax(0,1fr)]"
                      style={{ borderColor: 'var(--border-color)' }}
                    >
                      <dt
                        className="lp-key normal-case tracking-normal"
                        style={{ color: 'var(--text-tertiary)', paddingTop: '0.2rem' }}
                      >
                        {row.cite}
                      </dt>
                      <dd className="lp-body text-[0.875rem]">{row.body}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>

            {/* ---- The unusual one: erasure that leaves the database ------- */}
            <div
              className="lp-panel mt-11 p-5 sm:p-7"
              style={{
                borderLeftWidth: '3px',
                borderLeftColor: 'var(--color-signal-measured)',
              }}
            >
              <p className="lp-key normal-case tracking-normal">GDPR Art. 17</p>

              <h3 className="lp-h3 mt-2" style={{ fontSize: '1.25rem' }}>
                Erasure that reaches the fleet
              </h3>

              <p className="lp-body mt-3">
                Deletion requests reach beyond the central database. The platform clears personal
                information from reachable robots&rsquo; memory and removes operator and site
                details from their identity cards, recording the result of both steps.
              </p>

              <p className="lp-body mt-3">
                Offline robots are reported as unreachable, so an incomplete erasure stays visible
                until it can be resolved.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

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

const RECORDS: RecordRow[] = [
  {
    cite: 'Art. 12',
    body:
      'Hash-chained, tamper-evident audit logs. GET /api/compliance/verify re-walks the chain and names the links that no longer match.',
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
              No cloud key.
              <br />
              No data leaving the building.
            </h2>

            <p className="lp-lede mt-5">
              One environment variable moves the platform&rsquo;s AI onto a model running in your
              own building. What it decides there is still on the record — hash-chained, and
              verifiable by whoever you have to show it to.
            </p>

            {/* Asymmetric: the switch is narrow, the record is wide. */}
            <div className="mt-12 grid gap-11 lg:grid-cols-[minmax(0,21rem)_minmax(0,1fr)] lg:gap-14">
              {/* ---- 1. Local inference ------------------------------------ */}
              <div>
                <h3 className="lp-h3">Local inference</h3>

                <pre
                  className="lp-panel-inset mt-4 overflow-x-auto px-3.5 py-3 text-[0.8125rem] leading-relaxed"
                  style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}
                >
                  <code>
                    <span style={{ color: 'var(--text-primary)' }}>LLM_PROVIDER=</span>
                    gemini
                    <span style={{ color: 'var(--text-muted)' }}> | </span>
                    openrouter
                    <span style={{ color: 'var(--text-muted)' }}> | </span>
                    <span style={{ color: 'var(--color-signal-measured)', fontWeight: 600 }}>
                      ollama
                    </span>
                  </code>
                </pre>

                <p className="lp-body mt-4 text-[0.875rem]">
                  Set it to <span style={{ color: 'var(--text-primary)' }}>ollama</span> and the
                  whole {brand.name} server runs its AI on a local model: no cloud key, no data
                  leaving the building. One provider abstraction backs command interpretation, the
                  A2A orchestrator and dataset-curation suggestions, so the one variable moves all
                  three.
                </p>

                <p className="lp-body mt-3 text-[0.875rem]">
                  Local is not off the record. The model id that produced a decision is written
                  into the EU AI Act audit trail either way.
                </p>

                <p className="lp-key mt-4 normal-case tracking-normal">
                  server/src/services/llm/
                </p>
              </div>

              {/* ---- 2. The paper trail ------------------------------------ */}
              <div>
                <h3 className="lp-h3">The paper trail</h3>
                <p className="lp-body mt-3 text-[0.875rem]">
                  What is implemented today, and the article it answers to.
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
                An operator&rsquo;s place note, written on a robot standing at a customer site, is
                personal data that no database erasure would ever touch. So an Art. 17 request
                doesn&rsquo;t stop at the database. It wipes the on-robot memory workspace on every
                robot it can reach, redacts the operator and site fields on the robot&rsquo;s
                identity card, and counts both.
              </p>

              <p className="lp-body mt-3">
                A robot that was switched off is reported as unreachable — not as erased. An
                erasure that claims success while a note survives on a robot is the one answer a
                data-subject request must never get.
              </p>

              <p className="lp-key mt-4 normal-case tracking-normal">
                server/src/services/RobotMemoryErasureService.ts
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

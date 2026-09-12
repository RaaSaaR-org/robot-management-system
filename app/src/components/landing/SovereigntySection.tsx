/**
 * @file SovereigntySection.tsx
 * @description Landing section — Ownership: the platform is yours to run, and
 *              its own AI can run on a model in your own building.
 * @feature landing
 *
 * Every claim here is code-backed:
 *  - LLM_PROVIDER=gemini|openrouter|ollama → server/src/services/llm/index.ts
 *  - the deciding model is named in the trail → server/src/services/ComplianceService.ts
 *
 * The record itself — Art. 12 verification, Annex IV, the seven data-subject
 * request types, Art. 17 erasure reaching the fleet — is not summarised here
 * any more. A section on this page gets one supporting block, and the switch is
 * it; the citations live at /docs/platform#ownership-and-the-record.
 */

import { Link } from 'react-router-dom';

/** The three AI providers, and where each one runs. Local is the lit one. */
const PROVIDERS: readonly { name: string; where: string; local: boolean }[] = [
  { name: 'Gemini', where: 'Cloud', local: false },
  { name: 'OpenRouter', where: 'Cloud', local: false },
  { name: 'Ollama', where: 'Your hardware', local: true },
];

export function SovereigntySection() {
  return (
    <section id="ownership" className="lp-section lp-anchor" aria-labelledby="ownership-heading">
      <div className="lp-container">
        <div className="lp-grid">
          <div className="lp-rail">
            <span className="lp-rail-name">Ownership</span>
            <span className="lp-tag lp-tag-live">Live</span>
          </div>

          <div>
            <h2 id="ownership-heading" className="lp-display lp-h2">
              Your intelligence.
              <br />
              On your terms.
            </h2>

            {/* Careful wording: running the platform needs no account, which is
                true. It does not say nothing ever does — the Cosmos 3 generator
                wants a paid HuggingFace account and a hosted provider wants its
                key, both stated at /docs/platform#models. */}
            <p className="lp-lede mt-5">
              The platform is MIT-licensed and self-hosted: clone it and it runs, with no account
              and no licence server. Point its own AI at a model in your own building and the
              reasoning stays on site too.
            </p>

            {/* The switch, drawn as a switch. It used to print the environment
                variable verbatim, which made the whole claim read as a config
                note — the point is that it is one setting, not which setting it
                happens to be. */}
            <div
              className="lp-panel-inset mt-9 flex max-w-sm overflow-hidden"
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

            {/* The one fact the drawing cannot carry: it is a single setting,
                and choosing the local one does not take the decision off the
                record. */}
            <p className="lp-body mt-4 text-[0.875rem]">
              It is one setting, not three — and whichever provider you pick, the model that made a
              decision is named in the audit trail.
            </p>

            <Link
              to="/docs/platform#ownership-and-the-record"
              className="lp-btn-secondary mt-7 inline-flex px-5 py-3 text-sm"
            >
              Read how the record works →
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

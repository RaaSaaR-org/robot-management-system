/**
 * @file CommunitySection.tsx
 * @description Who builds NeoDEM — EmAI Robotics GmbH plus a 24/7 agentic crew,
 *              stated as a hairline ledger of filled and open roles.
 * @feature landing
 */

import { useBrand } from '@/brand';

const CONTACT_EMAIL = 'info@EmAI.dev';

type Slot = 'filled' | 'open';

interface Party {
  key: string;
  name: string;
  /** Mono sub-label — what this role is. */
  role: string;
  slot: Slot;
  description: string;
}

const PARTIES: Party[] = [
  {
    key: 'emai',
    name: 'EmAI Robotics GmbH',
    role: 'Steward · Saarbrücken, Germany',
    slot: 'filled',
    description:
      'Sets direction, reviews what the crew ships, and maintains the open-source release. The day-to-day work — writing code, running the test suite, triaging issues, shipping fixes — runs on AI agents around the clock.',
  },
  {
    key: 'cloud',
    name: 'Public cloud host',
    role: 'Partner slot',
    slot: 'open',
    description:
      'Help make the platform easier to try. Today it is self-hosted; a public hosting partner could let more teams explore it without setting up their own instance.',
  },
  {
    key: 'compute',
    name: 'Compute, inference and training credits',
    role: 'Partner slot',
    slot: 'open',
    description:
      'Support more training and evaluation experiments with GPU time and inference credits, from SmolVLA fine-tuning to testing the next model.',
  },
];

export function CommunitySection() {
  const brand = useBrand();

  return (
    <section id="who" className="lp-section lp-anchor" aria-labelledby="who-heading">
      <div className="lp-container">
        <div className="lp-grid">
          <div className="lp-rail">
            <span className="lp-rail-name">Who</span>
            <span className="lp-tag lp-tag-live">Live</span>
          </div>

          <div>
            <h2 id="who-heading" className="lp-display lp-h2">
              Build what comes next.
              <br />
              In the open.
            </h2>

            <p className="lp-lede mt-5">
              {brand.name} is built by EmAI Robotics GmbH in Saarbrücken, Germany, with AI agents
              contributing code, tests and fixes. People set the direction and review the work.
              The platform is MIT-licensed and public. Bring your ideas, your hardware or your
              next experiment.
            </p>

            {/* Ledger of roles. Filled and open are told apart by the tag and the
                hairline, not by a glowing card. */}
            <p className="lp-key mt-12">The team and open opportunities</p>

            <ul
              className="mt-3 border-b"
              role="list"
              style={{ borderColor: 'var(--border-color)' }}
            >
              {PARTIES.map((party) => (
                <li
                  key={party.key}
                  className="border-t py-5"
                  style={{ borderColor: 'var(--border-color)' }}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
                    <h3 className="lp-h3">{party.name}</h3>
                    {party.slot === 'filled' ? (
                      <span className="lp-tag lp-tag-live shrink-0">Active</span>
                    ) : (
                      <span
                        className="lp-tag shrink-0"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        Open
                      </span>
                    )}
                  </div>
                  <p className="lp-note mt-1.5">{party.role}</p>
                  <p className="lp-body mt-3">{party.description}</p>
                </li>
              ))}
            </ul>

            {/* Last block on the page. One line of finality and the contact action —
                deliberately not a CTA band; the closing slab was cut for good reason. */}
            <p className="lp-body mt-10">
              Have a robot, a research question or a use case worth exploring? Let&rsquo;s build
              the next step together. The code, the evidence and the open problems are public.
            </p>

            <div className="mt-6">
              <a
                href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(
                  `${brand.name} partner slot`,
                )}`}
                className="lp-btn-secondary inline-flex min-h-[2.75rem] items-center px-5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
              >
                Start a conversation
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * @file RunItSection.tsx
 * @description Install section — what it costs to start, and a link to the commands.
 * @feature landing
 *
 * The commands used to live here: a three-tab block with the Local, Docker and
 * Kubernetes pastes, a copy button and a roving tab strip. They moved to
 * docs/platform.md#install in TASK-309, and the reason is drift. Two of the
 * commands on this page were wrong once — `npx prisma migrate dev` aborted with
 * P3019 against a `sqlite` schema, and the G1 dev script silently started an H1
 * on :41243 because `.env.g1` is untracked and dotenv no-ops on a missing file. A
 * command that fails on the first paste costs more credibility than it buys, and
 * commands next to the repository get corrected when the repository changes.
 *
 * What stays is the part a reader wants before they decide to try it at all: how
 * long it takes, what it costs, and who they have to sign up with.
 */

import { Link } from 'react-router-dom';

const REPO_URL = 'https://github.com/RaaSaaR-org/robot-management-system';

// The three numbers, re-checked against the repo: the local path is still three
// terminals with no Docker and no database to install, the licence is still MIT
// (stated in the README, which has no LICENSE file to point at), and nothing in
// the stack asks for an account or a key.
const REQUIREMENTS: readonly { k: string; v: string; note: string }[] = [
  {
    k: 'Clone to running',
    v: '~5 minutes',
    note: 'Three terminals, no Docker required',
  },
  { k: 'Licence', v: 'MIT', note: 'Yours to fork, ship and sell' },
  {
    k: 'Accounts needed',
    v: 'None',
    note: 'No key, no seat count, nothing phones home',
  },
];

export function RunItSection() {
  return (
    <section id="install" className="lp-section lp-anchor" aria-labelledby="runit-heading">
      <div className="lp-container">
        <div className="lp-grid">
          <div className="lp-rail">
            <span className="lp-rail-name">Install</span>
            <span className="lp-tag lp-tag-live">Live</span>
          </div>

          <div>
            <h2 id="runit-heading" className="lp-display lp-h2">
              Your robotic cloud.
              <br />
              On your hardware.
            </h2>

            <p className="lp-lede mt-5">
              The same platform runs on a laptop, on Docker Compose, or on the Helm chart in this
              repository. MIT-licensed and self-hosted: no managed cloud to sign up for, no
              account, nothing phoning home.
            </p>

            {/* The section's one supporting block. */}
            <dl className="mt-9 grid max-w-2xl grid-cols-1 sm:grid-cols-3">
              {REQUIREMENTS.map((item, i) => (
                <div
                  key={item.k}
                  className={
                    i === 0
                      ? 'py-3 sm:pr-5'
                      : 'border-t py-3 sm:border-t-0 sm:border-l sm:px-5 sm:last:pr-0'
                  }
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

            <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
              <Link
                to="/docs/platform#install"
                className="lp-btn-secondary inline-flex px-5 py-3 text-sm"
              >
                Read the install commands →
              </Link>
              <a
                href={REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="lp-key inline-flex min-h-[2.75rem] items-center rounded transition-colors hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                style={{ color: 'var(--text-primary)' }}
              >
                Read the source →
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

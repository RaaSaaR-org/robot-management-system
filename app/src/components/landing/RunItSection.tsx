/**
 * @file RunItSection.tsx
 * @description Install paths — one repo, three ways to start it, as real commands.
 * @feature landing
 *
 * Replaces DeploymentSection.tsx. That version was three near-identical marketing
 * cards for what is really one repository with three install paths, and it badged
 * Kubernetes "Coming Soon" directly next to "Helm chart included". The chart ships
 * in helm/neodem, so the tab says so and the command is the one you would type.
 *
 * Every command here has been checked against the repo it installs, because a
 * command that fails on the first paste is worse than no command at all. Two were
 * wrong and are fixed:
 *
 *   - `npx prisma migrate dev` aborts with P3019: schema.prisma is `sqlite` while
 *     migrations/migration_lock.toml is `postgresql`. CI never hit it because
 *     .github/workflows/check.yml uses `prisma db push`. So does this block now.
 *   - `npm run dev:g1` alone does not start a G1. The script is
 *     `DOTENV_CONFIG_PATH=.env.g1 tsx watch src/index.ts`, .env.g1 is untracked,
 *     and dotenv no-ops on a missing file — config.ts then falls through to its
 *     defaults (h1, sim-robot-001, :41243). Writing the file is now a visible step.
 *
 * This is also the page's only remaining tab system, so it carries the pattern:
 * roving tabindex, arrow/Home/End keys, lp-key labels, 44px targets.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useBrand } from '@/brand';

const REPO_URL = 'https://github.com/RaaSaaR-org/robot-management-system';
const HELM_URL = 'https://github.com/RaaSaaR-org/robot-management-system/tree/main/helm/neodem';

interface InstallPath {
  id: string;
  /** Tab label */
  label: string;
  /** Mono caption in the panel header */
  header: string;
  /** Exactly what you paste */
  command: string;
  /** What you get, stated plainly */
  note: string;
}

const PATHS: readonly InstallPath[] = [
  {
    id: 'local',
    label: 'Local',
    header: 'bash · dev machine',
    command: `git clone ${REPO_URL}
cd robot-management-system

cp server/.env.example server/.env
cd server && npm install && npx prisma db push && npm run dev

cd ../robot-agent && npm install
cp .env.example .env.g1
printf 'ROBOT_TYPE=g1\\nROBOT_ID=sim-robot-g1\\nPORT=41244\\n' >> .env.g1
npm run dev:g1

cd ../app && npm install && npm run dev     # http://localhost:1420`,
    note: 'Three terminals, no Docker and no database to install — about five minutes from clone to a G1 reporting live simulated telemetry. The two lines that write .env.g1 are load-bearing: that file is not in the repo, and without it dev:g1 quietly starts a different robot on a different port.',
  },
  {
    id: 'docker',
    label: 'Docker',
    header: 'bash · repo root',
    command: 'docker compose up -d',
    note: 'The full stack in one command: server, app and robot agent on PostgreSQL, with NATS and RustFS alongside them.',
  },
  {
    id: 'kubernetes',
    label: 'Kubernetes',
    header: 'bash · cluster context',
    command: 'helm install neodem ./helm/neodem',
    note: 'The chart in helm/neodem covers the server, app and robot agent plus ingress, autoscaling, a pod disruption budget, a network policy and optional in-cluster PostgreSQL, NATS and RustFS. It ships in the repo — this is not a roadmap item.',
  },
];

// What a reader actually wants to know before pasting a command: how long,
// what it costs, and who they have to sign up with. The runtime versions and
// the optional infrastructure moved to the footnote below the tabs — true, but
// not the three numbers this block should be spending its size on.
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

/** Splits a trailing `  # comment` off a command line so it can be dimmed. */
function splitComment(line: string): [string, string | null] {
  const match = /^(.*?)(\s{2,}#.*)$/.exec(line);
  if (!match) return [line, null];
  return [match[1], match[2]];
}

type CopyState = 'idle' | 'copied' | 'unavailable';

export function RunItSection() {
  const brand = useBrand();
  const [active, setActive] = useState<string>(PATHS[0].id);
  const [copy, setCopy] = useState<{ id: string; state: CopyState } | null>(null);
  const timerRef = useRef<number | null>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  const flash = useCallback((id: string, state: CopyState) => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    setCopy({ id, state });
    timerRef.current = window.setTimeout(() => setCopy(null), 2000);
  }, []);

  const handleCopy = useCallback(
    (path: InstallPath) => {
      const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
      if (!clipboard || typeof clipboard.writeText !== 'function') {
        flash(path.id, 'unavailable');
        return;
      }
      clipboard.writeText(path.command).then(
        () => flash(path.id, 'copied'),
        () => flash(path.id, 'unavailable'),
      );
    },
    [flash],
  );

  const handleTabKey = useCallback((event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number | null = null;
    if (event.key === 'ArrowRight') next = (index + 1) % PATHS.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + PATHS.length) % PATHS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = PATHS.length - 1;
    if (next === null) return;
    event.preventDefault();
    const target = PATHS[next];
    setActive(target.id);
    tabRefs.current[target.id]?.focus();
  }, []);

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
              The same platform scales from a laptop to a cluster without changing repository.
              Start on your own machine, move the identical stack to Docker Compose when the team
              grows, and install the Helm chart when it becomes infrastructure. {brand.name} is
              MIT-licensed and self-hosted — there is no managed cloud to sign up for, and nothing
              here phones home.
            </p>

            {/* Tabbed command block — one panel per install path. */}
            <div className="mt-9">
              <div
                role="tablist"
                aria-label="Install paths"
                className="flex flex-wrap gap-x-1 border-b"
                style={{ borderColor: 'var(--border-color)' }}
              >
                {PATHS.map((path, index) => {
                  const selected = path.id === active;
                  return (
                    <button
                      key={path.id}
                      type="button"
                      role="tab"
                      id={`runit-tab-${path.id}`}
                      aria-selected={selected}
                      aria-controls={`runit-panel-${path.id}`}
                      tabIndex={selected ? 0 : -1}
                      ref={(el) => {
                        tabRefs.current[path.id] = el;
                      }}
                      onClick={() => setActive(path.id)}
                      onKeyDown={(event) => handleTabKey(event, index)}
                      className="lp-key -mb-px flex min-h-[2.75rem] items-center px-4 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                      style={{
                        // Unselected tabs are interactive labels, not decoration —
                        // --text-muted measured 2.41:1 against the page background.
                        color: selected ? 'var(--text-primary)' : 'var(--text-secondary)',
                        borderBottom: `2px solid ${selected ? 'var(--color-primary)' : 'transparent'}`,
                      }}
                    >
                      {path.label}
                    </button>
                  );
                })}
              </div>

              {PATHS.map((path) => {
                const selected = path.id === active;
                const copyState = copy?.id === path.id ? copy.state : 'idle';
                return (
                  <div
                    key={path.id}
                    role="tabpanel"
                    id={`runit-panel-${path.id}`}
                    aria-labelledby={`runit-tab-${path.id}`}
                    hidden={!selected}
                    className="mt-5"
                  >
                    <div className="lp-panel overflow-hidden">
                      <div
                        className="flex items-center justify-between gap-3 border-b pl-4 pr-2"
                        style={{ borderColor: 'var(--border-color)' }}
                      >
                        <span className="lp-key truncate py-2">{path.header}</span>
                        <button
                          type="button"
                          onClick={() => handleCopy(path)}
                          aria-label={`Copy the ${path.label} commands`}
                          className="lp-key flex min-h-[2.75rem] min-w-[2.75rem] items-center justify-center rounded px-3 transition-colors hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                          style={{
                            color:
                              copyState === 'copied'
                                ? 'var(--color-signal-measured)'
                                : copyState === 'unavailable'
                                  ? 'var(--color-signal-unknown)'
                                  : 'var(--text-secondary)',
                          }}
                        >
                          {copyState === 'copied' && 'Copied'}
                          {copyState === 'unavailable' && 'Select it'}
                          {copyState === 'idle' && 'Copy'}
                        </button>
                      </div>

                      {/*
                        tabIndex={0} so a keyboard user can scroll the overflow, which
                        means it needs a visible focus indicator. The ring is inset: the
                        panel is overflow-hidden and this element is full-bleed inside it,
                        so an offset ring would be clipped on both edges.
                      */}
                      <pre
                        className="overflow-x-auto px-4 py-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset"
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: '0.8125rem',
                          lineHeight: 1.75,
                          overflowX: 'auto',
                        }}
                        tabIndex={0}
                        aria-label={`${path.label} install commands`}
                      >
                        <code>
                          {path.command.split('\n').map((line, i) => {
                            const [code, comment] = splitComment(line);
                            return (
                              <span
                                key={`${path.id}-${i}`}
                                className="block whitespace-pre"
                                style={{ color: 'var(--text-primary)' }}
                              >
                                {code === '' && comment === null ? ' ' : code}
                                {comment !== null && (
                                  // Secondary, not muted: the only comment in the block is
                                  // the URL you are meant to open, and muted rendered it at
                                  // 2.9:1 (tertiary 3.44:1) on the panel. Secondary measures
                                  // 6.5:1 and still reads a clear step below the code, which
                                  // is --text-primary at ~15:1.
                                  <span style={{ color: 'var(--text-secondary)' }}>{comment}</span>
                                )}
                              </span>
                            );
                          })}
                        </code>
                      </pre>

                      <p
                        className="border-t px-4 py-3 text-[0.8125rem] leading-relaxed"
                        style={{
                          borderColor: 'var(--border-color)',
                          color: 'var(--text-secondary)',
                        }}
                      >
                        {path.note}
                      </p>
                    </div>
                  </div>
                );
              })}

              <p className="sr-only" role="status" aria-live="polite">
                {copy?.state === 'copied' ? 'Commands copied to the clipboard' : ''}
                {copy?.state === 'unavailable'
                  ? 'Clipboard unavailable — select the commands and copy them manually'
                  : ''}
              </p>
            </div>

            {/* What you actually need on the machine. */}
            <dl className="mt-10 grid max-w-2xl grid-cols-1 sm:grid-cols-3">
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

            <p className="lp-body mt-8">
              Training, model serving and twin reconstruction each run in their own sibling
              repository, so a GPU box can carry the heavy work without carrying the fleet. Clone
              this one and you can collect data and operate robots; fine-tuning, serving and
              building a twin want their neighbours cloned alongside it. All of them are MIT, all
              of them are linked from the README, and container images for the three services here
              publish to the GitHub registry.
            </p>

            {/* The spec, in the size the spec deserves. It used to be three
                large readouts at the top of this block, which made "which
                Node?" the loudest thing in the section. */}
            <p className="lp-note mt-4">
              Under the hood: Node 22 for the server and robot agent (the app builds on 20+),
              SQLite locally and PostgreSQL in production, and NATS and object storage optional —
              absent, the features that need them switch themselves off and say so.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
              <a
                href={REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="lp-key inline-flex min-h-[2.75rem] items-center rounded transition-colors hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                style={{ color: 'var(--text-primary)' }}
              >
                Read the source →
              </a>
              <a
                href={HELM_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="lp-key inline-flex min-h-[2.75rem] items-center rounded transition-colors hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                style={{ color: 'var(--text-secondary)' }}
              >
                Browse the Helm chart →
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

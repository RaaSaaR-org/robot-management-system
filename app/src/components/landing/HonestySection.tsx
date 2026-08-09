/**
 * @file HonestySection.tsx
 * @description Landing ledger of the four states the platform refuses to fake —
 *              unconfirmed, unknown, null, sim — plus the safety layers behind them.
 * @feature landing
 *
 * Replaces the old SafetyPreview. Deliberately not a card grid: a definition
 * ledger of hairline-separated rows, left column the honest state as a mono
 * value, right column what it costs and why it is worth it.
 *
 * Every state and number here is one the code actually produces:
 * E-Stop delivery reporting (agent-mode-controller.ts), the LiDAR cone query
 * (range.ts), place belief with hysteresis, the SimBadge provenance rule, and
 * the TASK-200 geofence run — including the gap that run found, still open as
 * TASK-201 and disclosed here rather than left off the page.
 */


import type { ReactNode } from 'react';

interface LedgerRow {
  /** Subsystem the state belongs to. */
  field: string;
  /** The state, exactly as the platform reports it. */
  state: string;
  /** Signal colour for the state value. */
  color: string;
  /**
   * Maturity/semantics tag class suffix. Omitted when the tag would only
   * repeat the state value back ("UNKNOWN / Unknown"), which reads as a
   * rendering bug rather than as a second piece of information.
   */
  tag?: string;
  tagLabel?: string;
  body: ReactNode;
}

const ROWS: LedgerRow[] = [
  {
    field: 'E-Stop',
    state: 'UNCONFIRMED',
    color: 'var(--color-signal-stopped)',
    tag: 'lp-tag-stopped',
    tagLabel: 'Stopped',
    body: (
      <>
        The stop fires instantly on our side — but if the robot never acknowledged it, the banner
        reads <em>unconfirmed</em>, in red, rather than <em>stopped</em>. The last commands stay on
        screen as evidence that the robot may still be moving. Most systems would show you a green
        tick here.
      </>
    ),
  },
  {
    field: 'LiDAR range',
    state: 'UNKNOWN',
    color: 'var(--color-signal-unknown)',
    body: (
      <>
        &ldquo;How far to the rack?&rdquo; is measured with the LiDAR, not estimated by a language
        model. Scored in a simulated room where the true answer is known exactly, it came in at
        0.017 m average error over 24 measurements — against 0.94 m for the vision model&rsquo;s
        guess in the same room, which mostly declined to answer at all. Both are simulator figures;
        nothing from a physical sensor has been scored yet. And when the beam finds nothing, the
        answer is UNKNOWN. It is never rounded up to &ldquo;clear&rdquo;.
      </>
    ),
  },
  {
    field: 'Place',
    state: 'NULL',
    // --text-tertiary measures 3.84:1, and 22px at weight 600 is not WCAG
    // large text (that needs >=18.66px AND weight 700), so it would fail.
    color: 'var(--text-secondary)',
    body: (
      <>
        The robot knows where it is twice over: coordinates, and the name you gave the spot —
        STAGING, AISLE-1, DOCK-1. It holds that name steady at a boundary instead of flickering
        between two. Walk it onto floor nobody ever mapped and the answer becomes NULL, rather than
        the last place it happened to be sure about. The names come from the digital twin.
      </>
    ),
  },
  {
    field: 'Provenance',
    state: 'SIM',
    color: 'var(--color-signal-estimated)',
    body: (
      <>
        Simulated <em>robot telemetry</em> is badged reading by reading, not once per screen: IMU,
        joint states, motor temperatures, battery health, odometry, the sensor block and the hand
        touch pads each carry their own SIM pill, because the robot itself declares which of its
        readings are simulated. The badge travels with the number, so a simulated one cannot be
        read as measured. It stops at robot telemetry, though — the seeded fleet numbers in the
        dashboard screenshot further up this page carry no badge, because nothing there is
        claiming to be a sensor reading. That same rule is why every section of this page is
        tagged Live, Sim or Gated.
      </>
    ),
  },
];

const CLOSING_FACTS = [
  {
    key: 'Verified stop',
    value: '0.48 m clear',
    note:
      'A two-metre walk aimed at rack RACK-A stopped 0.48 m clear of it, plan abandoned, next command refused. Reproduced twice.',
  },
  {
    key: 'Crash recovery',
    value: 'Never a clean slate',
    note:
      'A log entry that was never closed means the last run crashed — so the next start-up says so, keeps the emergency stop held until somebody acknowledges it, and throws away where the robot thought it was and what it thought it was holding.',
  },
];

export function HonestySection() {
  return (
    <section id="safety" className="lp-section lp-anchor" aria-labelledby="safety-heading">
      <div className="lp-container">
        <div className="lp-grid">
          <div className="lp-rail">
            <span className="lp-rail-name">Safety</span>
            <span className="lp-tag lp-tag-sim">Sim</span>
          </div>

          <div>
            <h2 id="safety-heading" className="lp-display lp-h2">
              Four ways it refuses to guess.
            </h2>

            <p className="lp-lede mt-5">
              Each of these costs something — a stopped plan, a blank field, a caveat on a number
              you would rather just trust. The platform pays it and shows you the evidence. The
              stop, the distance and the sense of place are proven in simulation today, over the
              same controls a real G1 uses.
            </p>

            {/* The ledger. Hairline rows, no boxes, no icons. */}
            <dl className="mt-12">
              {ROWS.map((row) => (
                <div
                  key={row.state}
                  className="lp-rule grid grid-cols-1 gap-x-12 gap-y-3 py-7 lg:grid-cols-[13rem_minmax(0,1fr)]"
                >
                  <dt>
                    <span className="lp-key block">{row.field}</span>
                    <span
                      className="mt-2 block break-words"
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '1.375rem',
                        fontWeight: 600,
                        letterSpacing: '0.02em',
                        lineHeight: 1.15,
                        color: row.color,
                      }}
                    >
                      {row.state}
                    </span>
                    {row.tag && row.tagLabel ? (
                      <span className={`lp-tag ${row.tag} mt-3`}>{row.tagLabel}</span>
                    ) : null}
                  </dt>
                  <dd className="lp-body">{row.body}</dd>
                </div>
              ))}
            </dl>

            {/* What holds when one of those states is the answer. */}
            <div className="lp-rule pt-10">
              <h3 className="lp-h3">Four layers, and a robot that remembers the last one.</h3>

              <p className="lp-body mt-4">
                An emergency stop exists at four scopes: the whole fleet, one zone, one robot, and
                human approval — where anything flagged high-risk waits in a queue until a person
                signs it off. Underneath sits an enforced keep-out zone: cross into one while the
                robot <em>trusts</em> where it is and it stops itself, abandons the plan it was
                running, and refuses the next command until someone clears it.
              </p>

              {/* The gap TASK-200's own run found. Open, priority 1, and on the
                  page: a safety claim that hides its exception is worth less
                  than the exception. */}
              <div
                className="lp-panel mt-8 p-5 sm:p-7"
                style={{
                  borderLeftWidth: '3px',
                  borderLeftColor: 'var(--color-signal-unknown)',
                }}
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <span className="lp-tag lp-tag-gated">Open defect</span>
                  <span className="lp-key">TASK-201</span>
                </div>

                {/* h4, and deliberately not sized above the h3 it sits under —
                    the panel and the rule do the emphasis, not the type size. */}
                <h4 className="lp-h3 mt-3">And the fence stops enforcing before it says so</h4>

                <p className="lp-body mt-3">
                  That word <em>trusts</em> is load-bearing. Once a robot has walked far enough
                  without a fresh fix — 15 m by default, in a hall 20 m long — it stops trusting
                  its own position. The fence then answers <em>unknown</em>, and the safety layer
                  is deliberately built to do nothing on unknown. In the same warehouse session
                  that produced the 0.48 m stop below, once that distance was spent, the robot
                  walked straight through rack RACK-A and out the far side — with the emergency
                  stop armed, the system reporting healthy, and not one warning raised.
                </p>

                <p className="lp-body mt-3">
                  Every part of the system did exactly what it was written to do. What is missing
                  is that the lapse is invisible to the operator, and the fix is not to weaken the
                  fence: a
                  pose that may be tens of metres wrong genuinely is not evidence about where the
                  robot is. The fix is for the console to say when the fence has stopped enforcing.
                  It is open, priority 1, and it is written here because a safety claim that omits
                  its own known exception is not a safety claim.
                </p>
              </div>

              <dl className="mt-8 grid grid-cols-1 sm:grid-cols-2">
                {CLOSING_FACTS.map((fact, i) => (
                  <div
                    key={fact.key}
                    className={
                      i === 0
                        ? 'py-4 sm:pr-8'
                        : 'border-t py-4 sm:border-t-0 sm:border-l sm:pl-8'
                    }
                    style={{ borderColor: 'var(--border-color)' }}
                  >
                    <dt className="lp-key">{fact.key}</dt>
                    <dd>
                      <span className="lp-value mt-1.5 block">{fact.value}</span>
                      <span className="lp-note mt-2 block">{fact.note}</span>
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

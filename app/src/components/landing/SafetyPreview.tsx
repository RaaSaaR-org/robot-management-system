/**
 * @file SafetyPreview.tsx
 * @description Landing page section showcasing the real safety/control hierarchy
 * @feature landing
 */

import { ShieldAlert, ShieldCheck, Bot, CheckCircle2 } from 'lucide-react';

const COBALT = '#2A5FFF';
const TURQUOISE = '#18E4C3';

interface StatusRow {
  key: string;
  Icon: typeof ShieldAlert;
  label: string;
  target: string;
  status: string;
  tone: 'turquoise' | 'cobalt' | 'muted';
  pulse?: boolean;
}

const STATUS_ROWS: StatusRow[] = [
  {
    key: 'fleet',
    Icon: ShieldAlert,
    label: 'FLEET E-STOP',
    target: 'All robots',
    status: 'ARMED',
    tone: 'turquoise',
    pulse: true,
  },
  {
    key: 'zone',
    Icon: ShieldCheck,
    label: 'ZONE',
    target: 'ASSEMBLY-A',
    status: 'OK',
    tone: 'cobalt',
  },
  {
    key: 'robot',
    Icon: Bot,
    label: 'ROBOT',
    target: 'demo-h1-001',
    status: 'OK',
    tone: 'cobalt',
  },
  {
    key: 'approvals',
    Icon: CheckCircle2,
    label: 'APPROVALS',
    target: 'Human review queue',
    status: '0 PENDING',
    tone: 'muted',
  },
];

function toneStyles(tone: StatusRow['tone']) {
  if (tone === 'turquoise') {
    return {
      border: 'border-turquoise/60',
      bg: 'bg-turquoise/5',
      labelColor: 'text-turquoise',
      statusColor: 'text-turquoise',
      dotColor: TURQUOISE,
    };
  }
  if (tone === 'cobalt') {
    return {
      border: 'border-cobalt/50',
      bg: 'bg-cobalt/5',
      labelColor: 'text-cobalt',
      statusColor: 'text-theme-primary',
      dotColor: COBALT,
    };
  }
  return {
    border: 'border-theme',
    bg: 'bg-transparent',
    labelColor: 'text-theme-muted',
    statusColor: 'text-theme-secondary',
    dotColor: '#78716C',
  };
}

export function SafetyPreview() {
  return (
    <section id="safety" className="py-24 section-primary relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-turquoise/5 to-transparent" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          {/* Copy */}
          <div>
            <p className="text-turquoise font-mono text-sm mb-4 tracking-wider uppercase">
              Safety &amp; Control
            </p>
            <h2 className="text-3xl sm:text-4xl font-bold text-theme-primary mb-6">
              Stop any robot. Any zone. Any time.
            </h2>
            <p className="text-theme-secondary text-lg mb-8">
              Real emergency stops wired through every layer — fleet, zone, and robot — plus a
              human approval workflow for anything that needs a greenlight.
            </p>

            <div className="space-y-4">
              <div className="flex items-start gap-4">
                <div className="w-8 h-8 rounded-lg bg-turquoise/15 border border-turquoise/30 flex items-center justify-center flex-shrink-0 mt-1">
                  <ShieldAlert className="w-4 h-4 text-turquoise" />
                </div>
                <div>
                  <h4 className="text-theme-primary font-medium mb-1">
                    Fleet, zone, and per-robot emergency stop
                  </h4>
                  <p className="text-theme-tertiary">
                    Three tiers of kill switches wired into the dashboard, fleet map, and every
                    robot detail page — hit the one that matches your scope.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="w-8 h-8 rounded-lg bg-cobalt/15 border border-cobalt/30 flex items-center justify-center flex-shrink-0 mt-1">
                  <ShieldCheck className="w-4 h-4 text-cobalt" />
                </div>
                <div>
                  <h4 className="text-theme-primary font-medium mb-1">
                    Live operating-mode and speed-limit monitoring
                  </h4>
                  <p className="text-theme-tertiary">
                    Every robot reports its current mode, speed envelope, and safety health —
                    visible at a glance on the safety dashboard.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="w-8 h-8 rounded-lg bg-cobalt/15 border border-cobalt/30 flex items-center justify-center flex-shrink-0 mt-1">
                  <CheckCircle2 className="w-4 h-4 text-cobalt" />
                </div>
                <div>
                  <h4 className="text-theme-primary font-medium mb-1">
                    Human approval workflow for high-risk actions
                  </h4>
                  <p className="text-theme-tertiary">
                    A task flagged as high-risk waits in the approvals queue until a human
                    reviewer signs it off — nothing rolls out unattended.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Status panel — HUD style, matches LifecycleLoopSection vibe */}
          <div className="relative">
            <div className="rounded-2xl border border-theme bg-theme-card overflow-hidden">
              {/* Panel header */}
              <div className="px-5 py-3 border-b border-theme flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <div className="w-2.5 h-2.5 rounded-full bg-turquoise" />
                    <div className="absolute inset-0 w-2.5 h-2.5 rounded-full bg-turquoise animate-ping" />
                  </div>
                  <span className="text-theme-secondary text-sm font-mono tracking-wider">
                    SAFETY CONTROL
                  </span>
                </div>
                <span className="text-theme-muted text-xs font-mono">LIVE</span>
              </div>

              {/* Dotted HUD grid backdrop + status rows */}
              <div className="relative p-5">
                <div
                  className="absolute inset-0 opacity-[0.06] pointer-events-none"
                  style={{
                    backgroundImage:
                      'radial-gradient(circle, #F5F5F4 0.7px, transparent 0.7px)',
                    backgroundSize: '16px 16px',
                  }}
                />

                <div className="relative space-y-3">
                  {STATUS_ROWS.map((row) => {
                    const s = toneStyles(row.tone);
                    return (
                      <div
                        key={row.key}
                        className={`relative flex items-center justify-between gap-4 rounded-lg border ${s.border} ${s.bg} px-4 py-3`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <row.Icon className={`w-4 h-4 flex-shrink-0 ${s.labelColor}`} />
                          <div className="min-w-0">
                            <div
                              className={`font-mono text-[11px] tracking-wider uppercase ${s.labelColor}`}
                            >
                              {row.label}
                            </div>
                            <div className="text-theme-secondary text-xs font-mono truncate">
                              {row.target}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <div className="relative flex items-center justify-center w-3 h-3">
                            <div
                              className="absolute inset-0 rounded-full"
                              style={{ backgroundColor: s.dotColor, opacity: 0.9 }}
                            />
                            {row.pulse && (
                              <div
                                className="absolute inset-0 rounded-full animate-ping"
                                style={{ backgroundColor: s.dotColor, opacity: 0.6 }}
                              />
                            )}
                          </div>
                          <span className={`font-mono text-xs tracking-wider ${s.statusColor}`}>
                            {row.status}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Footnote bar */}
              <div className="px-5 py-3 border-t border-theme flex items-center justify-between">
                <span className="text-theme-muted text-xs font-mono">
                  4 layers · humans always in the loop
                </span>
                <span className="text-theme-muted text-xs font-mono">v1 · open source</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * @file CommunitySection.tsx
 * @description Open-source community + stewards section — explains the agentic model
 *              and invites new supporters (cloud host, AI infrastructure).
 * @feature landing
 */

import type { ComponentType, SVGProps } from 'react';
import { Bot, Cloud, Cpu, Mail } from 'lucide-react';

type Status = 'active' | 'open';

interface Steward {
  key: string;
  name: string;
  role: string;
  description: string;
  status: Status;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
}

const STEWARDS: Steward[] = [
  {
    key: 'emai',
    name: 'EmAI Robotics GmbH',
    role: 'Steward · Agentic Ops · Tech Direction',
    description:
      'Set up the agentic development system and leads ideas plus technical direction — championing open-source software and open standards across the whole stack. Based in Saarbrücken, Germany.',
    status: 'active',
    Icon: Bot,
  },
  {
    key: 'cloud',
    name: 'Cloud Host',
    role: 'Looking for a partner',
    description:
      'Host a public NeoDEM trial so anyone can register, spin up a fleet, and drive the stack without self-hosting. No install, no friction — just click and explore Physical AI.',
    status: 'open',
    Icon: Cloud,
  },
  {
    key: 'ai-infra',
    name: 'AI Infrastructure',
    role: 'Looking for a partner',
    description:
      'Compute, inference, and training credits to grow the agentic development team — more experiments, faster iterations, and bigger foundation models powering the fleet.',
    status: 'open',
    Icon: Cpu,
  },
];

export function CommunitySection() {
  return (
    <section id="community" className="py-24 section-primary relative overflow-hidden">
      {/* Faint backdrop glow */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-turquoise/[0.04] rounded-full blur-3xl" />
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        {/* Section header */}
        <div className="text-center mb-16">
          <p className="text-turquoise font-mono text-sm mb-4 tracking-wider uppercase">
            Agentic · Open Source · Community
          </p>
          <h2 className="text-3xl sm:text-4xl font-bold text-theme-primary mb-4">
            Built in the open. Maintained by agents.
          </h2>
          <p className="text-theme-secondary text-lg max-w-2xl mx-auto">
            NeoDEM is an open-source community project with a 24/7 agentic crew.
            AI agents write code, run tests, triage issues, and ship fixes — while
            humans set direction. Agentic supported, community owned.
          </p>
        </div>

        {/* Stewards grid */}
        <div className="grid md:grid-cols-3 gap-6">
          {STEWARDS.map((steward) => {
            const isActive = steward.status === 'active';
            return (
              <div
                key={steward.key}
                className={`relative rounded-2xl p-6 lg:p-8 min-h-[320px] flex flex-col transition-all ${
                  isActive
                    ? 'border-2 border-turquoise/60 bg-turquoise/[0.04] shadow-[0_0_40px_rgba(24,228,195,0.12)]'
                    : 'border border-dashed border-cobalt/40 bg-cobalt/[0.02] hover:border-cobalt/70 hover:bg-cobalt/[0.05] hover:shadow-[0_0_30px_rgba(42,95,255,0.08)]'
                }`}
              >
                {/* HUD corner brackets for open slots */}
                {!isActive && (
                  <>
                    <div className="absolute top-0 left-0 w-5 h-5 border-t-[1.5px] border-l-[1.5px] border-cobalt/60 rounded-tl-2xl" />
                    <div className="absolute top-0 right-0 w-5 h-5 border-t-[1.5px] border-r-[1.5px] border-cobalt/60 rounded-tr-2xl" />
                    <div className="absolute bottom-0 left-0 w-5 h-5 border-b-[1.5px] border-l-[1.5px] border-cobalt/60 rounded-bl-2xl" />
                    <div className="absolute bottom-0 right-0 w-5 h-5 border-b-[1.5px] border-r-[1.5px] border-cobalt/60 rounded-br-2xl" />
                  </>
                )}

                {/* Top row: icon + status badge */}
                <div className="flex items-center justify-between mb-6">
                  <div
                    className={`w-12 h-12 rounded-xl flex items-center justify-center border ${
                      isActive
                        ? 'bg-turquoise/15 border-turquoise/40'
                        : 'bg-cobalt/10 border-cobalt/30'
                    }`}
                  >
                    <steward.Icon
                      width={24}
                      height={24}
                      stroke={isActive ? '#18E4C3' : '#2A5FFF'}
                      strokeWidth={2}
                      fill="none"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    {isActive ? (
                      <span className="relative flex items-center justify-center w-2 h-2">
                        <span className="absolute inline-flex h-full w-full rounded-full bg-turquoise opacity-75 animate-ping" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-turquoise" />
                      </span>
                    ) : (
                      <span className="inline-flex rounded-full h-2 w-2 border border-cobalt/60" />
                    )}
                    <span
                      className={`font-mono text-[10px] tracking-[0.18em] uppercase ${
                        isActive ? 'text-turquoise' : 'text-cobalt'
                      }`}
                    >
                      {isActive ? 'Active' : 'Open Slot'}
                    </span>
                  </div>
                </div>

                {/* Name + role */}
                <h3 className="text-xl font-bold text-theme-primary mb-1">{steward.name}</h3>
                <p className="font-mono text-[11px] text-theme-muted uppercase tracking-wider mb-4">
                  {steward.role}
                </p>

                {/* Description */}
                <p className="text-theme-secondary text-sm leading-relaxed">
                  {steward.description}
                </p>
              </div>
            );
          })}
        </div>

        {/* Contact CTA */}
        <div className="text-center mt-14">
          <p className="text-theme-muted font-mono text-xs uppercase tracking-[0.2em] mb-4">
            Want to help move Physical AI forward?
          </p>
          <a
            href="mailto:info@EmAI.dev?subject=NeoDEM%20Supporter"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl border border-turquoise/40 text-turquoise hover:bg-turquoise/10 hover:border-turquoise/70 transition-colors font-medium"
          >
            <Mail className="w-4 h-4" />
            Become a supporter
          </a>
        </div>
      </div>
    </section>
  );
}

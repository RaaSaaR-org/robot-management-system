/**
 * @file DataEcosystemSection.tsx
 * @description Section highlighting the training data ecosystem and data flywheel capabilities
 * @feature landing
 */

const pillars = [
  {
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"
        />
      </svg>
    ),
    title: 'Open Foundation',
    description:
      'Leverage 970K+ open trajectories from Open X-Embodiment. Fine-tune with ~100 demonstrations per task. Build on proven VLA architectures.',
    tags: ['970K+ trajectories', 'Quick fine-tuning'],
  },
  {
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
        />
      </svg>
    ),
    title: 'Multi-Modal Collection',
    description:
      'VR teleoperation for intuitive demonstration capture. High-fidelity simulation at 43M+ FPS. Automated quality validation pipelines.',
    tags: ['VR teleoperation', 'Sim-to-real transfer'],
  },
  {
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
        />
      </svg>
    ),
    title: 'Fleet Learning',
    description:
      'Federated learning across your robot fleet. Privacy-preserving data aggregation. Every robot contributes, every robot improves.',
    tags: ['Privacy-first', 'Continuous improvement'],
  },
  {
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"
        />
      </svg>
    ),
    title: 'Data Marketplace',
    description:
      'Contribute data, earn service credits. Access shared skill libraries. Track your fleet\'s impact on model improvements.',
    tags: ['Earn credits', 'Shared skills'],
  },
];

function FlywheelDiagram() {
  return (
    <div className="relative w-96 h-96 mx-auto mb-16">
      {/* Ambient glow effects */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-turquoise/10 rounded-full blur-3xl" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 bg-cobalt/15 rounded-full blur-2xl" />

      {/* Background grid */}
      <div
        className="absolute inset-0 rounded-full overflow-hidden opacity-30"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(42, 95, 255, 0.2) 1px, transparent 1px), linear-gradient(to bottom, rgba(42, 95, 255, 0.2) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
          animation: 'gridPulse 3s ease-in-out infinite',
        }}
      />

      {/* Scan line effect */}
      <div
        className="absolute inset-x-0 h-12 bg-gradient-to-b from-turquoise/15 via-turquoise/5 to-transparent pointer-events-none rounded-full"
        style={{ animation: 'scanLine 3s ease-in-out infinite' }}
      />

      <svg className="absolute inset-0 w-full h-full" viewBox="0 0 384 384">
        <defs>
          {/* Gradients */}
          <linearGradient id="flywheelGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#2A5FFF" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#18E4C3" stopOpacity="0.4" />
          </linearGradient>
          <linearGradient id="arcGradientCW" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#18E4C3" stopOpacity="0.6" />
            <stop offset="50%" stopColor="#2A5FFF" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#18E4C3" stopOpacity="0.2" />
          </linearGradient>
          <linearGradient id="hubGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#18E4C3" />
            <stop offset="100%" stopColor="#2A5FFF" />
          </linearGradient>
          <radialGradient id="nodeGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#18E4C3" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#18E4C3" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="nodeGlowCobalt" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#2A5FFF" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#2A5FFF" stopOpacity="0" />
          </radialGradient>

          {/* Glow filter */}
          <filter id="glowFilter" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="strongGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="6" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Outer rotating ring with tick marks */}
        <g style={{ transformOrigin: '192px 192px', animation: 'slowRotate 30s linear infinite' }}>
          <circle
            cx="192"
            cy="192"
            r="175"
            fill="none"
            stroke="url(#flywheelGradient)"
            strokeWidth="1"
            strokeDasharray="8 12"
          />
          {/* Tick marks */}
          {[...Array(24)].map((_, i) => {
            const angle = (i * 15 * Math.PI) / 180;
            const x1 = 192 + Math.cos(angle) * 168;
            const y1 = 192 + Math.sin(angle) * 168;
            const x2 = 192 + Math.cos(angle) * 175;
            const y2 = 192 + Math.sin(angle) * 175;
            return (
              <line
                key={i}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke="#2A5FFF"
                strokeWidth={i % 6 === 0 ? 2 : 1}
                opacity={i % 6 === 0 ? 0.6 : 0.3}
              />
            );
          })}
        </g>

        {/* Inner rotating ring (opposite direction) */}
        <g
          style={{
            transformOrigin: '192px 192px',
            animation: 'slowRotateReverse 20s linear infinite',
          }}
        >
          <circle
            cx="192"
            cy="192"
            r="145"
            fill="none"
            stroke="url(#arcGradientCW)"
            strokeWidth="1"
            strokeDasharray="4 8"
          />
        </g>

        {/* Pulse rings from center */}
        <circle
          cx="192"
          cy="192"
          r="50"
          fill="none"
          stroke="url(#flywheelGradient)"
          strokeWidth="2"
          filter="url(#glowFilter)"
        >
          <animate attributeName="r" values="50;140" dur="4s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.6;0" dur="4s" repeatCount="indefinite" />
        </circle>
        <circle cx="192" cy="192" r="50" fill="none" stroke="url(#flywheelGradient)" strokeWidth="2">
          <animate
            attributeName="r"
            values="50;140"
            dur="4s"
            repeatCount="indefinite"
            begin="1.33s"
          />
          <animate
            attributeName="opacity"
            values="0.6;0"
            dur="4s"
            repeatCount="indefinite"
            begin="1.33s"
          />
        </circle>
        <circle cx="192" cy="192" r="50" fill="none" stroke="url(#flywheelGradient)" strokeWidth="2">
          <animate
            attributeName="r"
            values="50;140"
            dur="4s"
            repeatCount="indefinite"
            begin="2.66s"
          />
          <animate
            attributeName="opacity"
            values="0.6;0"
            dur="4s"
            repeatCount="indefinite"
            begin="2.66s"
          />
        </circle>

        {/* Main arc paths with draw animation */}
        <path
          d="M 192 52 A 140 140 0 0 1 332 192"
          fill="none"
          stroke="url(#arcGradientCW)"
          strokeWidth="3"
          strokeLinecap="round"
          filter="url(#glowFilter)"
          strokeDasharray="220"
          strokeDashoffset="0"
        />
        <path
          d="M 332 192 A 140 140 0 0 1 192 332"
          fill="none"
          stroke="url(#arcGradientCW)"
          strokeWidth="3"
          strokeLinecap="round"
          filter="url(#glowFilter)"
        />
        <path
          d="M 192 332 A 140 140 0 0 1 52 192"
          fill="none"
          stroke="url(#arcGradientCW)"
          strokeWidth="3"
          strokeLinecap="round"
          filter="url(#glowFilter)"
        />
        <path
          d="M 52 192 A 140 140 0 0 1 192 52"
          fill="none"
          stroke="url(#arcGradientCW)"
          strokeWidth="3"
          strokeLinecap="round"
          filter="url(#glowFilter)"
        />

        {/* Data particles with trails - Primary particles */}
        <g filter="url(#glowFilter)">
          <circle r="6" fill="#2A5FFF">
            <animateMotion
              dur="2.5s"
              repeatCount="indefinite"
              path="M192,52 A140,140 0 0,1 332,192"
            />
          </circle>
          <circle r="3" fill="#2A5FFF" opacity="0.5">
            <animateMotion
              dur="2.5s"
              repeatCount="indefinite"
              path="M192,52 A140,140 0 0,1 332,192"
              begin="0.1s"
            />
          </circle>
        </g>
        <g filter="url(#glowFilter)">
          <circle r="6" fill="#18E4C3">
            <animateMotion
              dur="2.5s"
              repeatCount="indefinite"
              path="M332,192 A140,140 0 0,1 192,332"
              begin="0.625s"
            />
          </circle>
          <circle r="3" fill="#18E4C3" opacity="0.5">
            <animateMotion
              dur="2.5s"
              repeatCount="indefinite"
              path="M332,192 A140,140 0 0,1 192,332"
              begin="0.725s"
            />
          </circle>
        </g>
        <g filter="url(#glowFilter)">
          <circle r="6" fill="#2A5FFF">
            <animateMotion
              dur="2.5s"
              repeatCount="indefinite"
              path="M192,332 A140,140 0 0,1 52,192"
              begin="1.25s"
            />
          </circle>
          <circle r="3" fill="#2A5FFF" opacity="0.5">
            <animateMotion
              dur="2.5s"
              repeatCount="indefinite"
              path="M192,332 A140,140 0 0,1 52,192"
              begin="1.35s"
            />
          </circle>
        </g>
        <g filter="url(#glowFilter)">
          <circle r="6" fill="#18E4C3">
            <animateMotion
              dur="2.5s"
              repeatCount="indefinite"
              path="M52,192 A140,140 0 0,1 192,52"
              begin="1.875s"
            />
          </circle>
          <circle r="3" fill="#18E4C3" opacity="0.5">
            <animateMotion
              dur="2.5s"
              repeatCount="indefinite"
              path="M52,192 A140,140 0 0,1 192,52"
              begin="1.975s"
            />
          </circle>
        </g>

        {/* Secondary smaller particles for depth */}
        <circle r="2" fill="#18E4C3" opacity="0.7">
          <animateMotion
            dur="3.5s"
            repeatCount="indefinite"
            path="M192,52 A140,140 0 0,1 332,192"
            begin="0.5s"
          />
        </circle>
        <circle r="2" fill="#2A5FFF" opacity="0.7">
          <animateMotion
            dur="3.5s"
            repeatCount="indefinite"
            path="M332,192 A140,140 0 0,1 192,332"
            begin="1s"
          />
        </circle>
        <circle r="2" fill="#18E4C3" opacity="0.7">
          <animateMotion
            dur="3.5s"
            repeatCount="indefinite"
            path="M192,332 A140,140 0 0,1 52,192"
            begin="1.5s"
          />
        </circle>
        <circle r="2" fill="#2A5FFF" opacity="0.7">
          <animateMotion
            dur="3.5s"
            repeatCount="indefinite"
            path="M52,192 A140,140 0 0,1 192,52"
            begin="2s"
          />
        </circle>

        {/* Node glow effects */}
        <circle cx="192" cy="52" r="35" fill="url(#nodeGlow)" />
        <circle cx="332" cy="192" r="35" fill="url(#nodeGlowCobalt)" />
        <circle cx="192" cy="332" r="35" fill="url(#nodeGlow)" />
        <circle cx="52" cy="192" r="35" fill="url(#nodeGlowCobalt)" />

        {/* Central hub glow */}
        <circle cx="192" cy="192" r="55" fill="url(#nodeGlow)" />

        {/* Radar sweep from center */}
        <g style={{ transformOrigin: '192px 192px', animation: 'radarSweep 4s linear infinite' }}>
          <path
            d="M 192 192 L 192 82 A 110 110 0 0 1 269 127 Z"
            fill="url(#flywheelGradient)"
            opacity="0.15"
          />
        </g>
      </svg>

      {/* Central Hub */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-24 h-24 z-10">
        <div className="absolute inset-0 rounded-full bg-gradient-to-br from-turquoise/40 to-cobalt/40 blur-xl animate-pulse" />
        <div className="relative w-full h-full rounded-full bg-gradient-to-br from-turquoise to-cobalt p-[2px] shadow-2xl shadow-turquoise/40">
          <div className="w-full h-full rounded-full bg-gradient-to-br from-slate-900/95 to-slate-800/95 flex items-center justify-center backdrop-blur">
            {/* Animated cycle icon */}
            <svg
              className="w-10 h-10 text-turquoise"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              style={{ animation: 'spinSlow 8s linear infinite' }}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          </div>
        </div>
        {/* Status indicator */}
        <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-slate-900/90 border border-turquoise/30">
          <div className="relative">
            <div className="w-2 h-2 rounded-full bg-turquoise" />
            <div className="absolute inset-0 w-2 h-2 rounded-full bg-turquoise animate-ping" />
          </div>
          <span className="text-turquoise text-[10px] font-mono">ACTIVE</span>
        </div>
      </div>

      {/* Stage nodes - positioned around the circle */}
      {/* Collect - Top */}
      <div className="absolute top-2 left-1/2 -translate-x-1/2">
        <div className="relative">
          <div className="w-16 h-16 rounded-xl bg-slate-900/90 border border-turquoise/40 backdrop-blur-sm flex items-center justify-center shadow-lg shadow-turquoise/20">
            <svg
              className="w-7 h-7 text-turquoise"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
          </div>
          {/* Connection line pulse */}
          <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 w-0.5 h-3 bg-gradient-to-b from-turquoise/60 to-transparent" />
        </div>
        <p className="text-turquoise text-xs text-center mt-4 font-medium tracking-wide">COLLECT</p>
      </div>

      {/* Train - Right */}
      <div className="absolute right-2 top-1/2 -translate-y-1/2">
        <div className="relative">
          <div className="w-16 h-16 rounded-xl bg-slate-900/90 border border-cobalt/40 backdrop-blur-sm flex items-center justify-center shadow-lg shadow-cobalt/20">
            <svg
              className="w-7 h-7 text-cobalt"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
              />
            </svg>
          </div>
          <div className="absolute top-1/2 -left-3 -translate-y-1/2 h-0.5 w-3 bg-gradient-to-l from-cobalt/60 to-transparent" />
        </div>
        <p className="text-cobalt text-xs text-center mt-1 font-medium tracking-wide">TRAIN</p>
      </div>

      {/* Deploy - Bottom */}
      <div className="absolute bottom-2 left-1/2 -translate-x-1/2">
        <div className="relative">
          <div className="w-16 h-16 rounded-xl bg-slate-900/90 border border-turquoise/40 backdrop-blur-sm flex items-center justify-center shadow-lg shadow-turquoise/20">
            <svg
              className="w-7 h-7 text-turquoise"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"
              />
            </svg>
          </div>
          <div className="absolute -top-3 left-1/2 -translate-x-1/2 w-0.5 h-3 bg-gradient-to-t from-turquoise/60 to-transparent" />
        </div>
        <p className="text-turquoise text-xs text-center mt-1 font-medium tracking-wide">DEPLOY</p>
      </div>

      {/* Improve - Left */}
      <div className="absolute left-2 top-1/2 -translate-y-1/2">
        <div className="relative">
          <div className="w-16 h-16 rounded-xl bg-slate-900/90 border border-cobalt/40 backdrop-blur-sm flex items-center justify-center shadow-lg shadow-cobalt/20">
            <svg
              className="w-7 h-7 text-cobalt"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
              />
            </svg>
          </div>
          <div className="absolute top-1/2 -right-3 -translate-y-1/2 h-0.5 w-3 bg-gradient-to-r from-cobalt/60 to-transparent" />
        </div>
        <p className="text-cobalt text-xs text-center mt-1 font-medium tracking-wide">IMPROVE</p>
      </div>
    </div>
  );
}

export function DataEcosystemSection() {
  return (
    <section className="py-24 section-secondary">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="text-center mb-12">
          <p className="text-turquoise font-mono text-sm mb-4 tracking-wider uppercase">
            Data Flywheel
          </p>
          <h2 className="text-3xl sm:text-4xl font-bold text-theme-primary mb-4">
            Build Your Training Data Ecosystem
          </h2>
          <p className="text-theme-secondary text-lg max-w-2xl mx-auto">
            Every deployed robot improves the entire fleet. Leverage the data flywheel effect that
            powers the world's most advanced robotics platforms.
          </p>
        </div>

        {/* Flywheel Diagram */}
        <FlywheelDiagram />

        {/* Pillars Grid */}
        <div className="grid md:grid-cols-2 gap-8">
          {pillars.map((pillar, index) => (
            <div
              key={index}
              className="card p-8 hover:shadow-lg border-l-4 border-l-transparent hover:border-l-turquoise transition-all duration-300"
            >
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-turquoise/10 to-cobalt/10 text-turquoise flex items-center justify-center flex-shrink-0">
                  {pillar.icon}
                </div>
                <div className="flex-1">
                  <h3 className="text-xl font-semibold text-theme-primary mb-3">{pillar.title}</h3>
                  <p className="text-theme-secondary mb-4">{pillar.description}</p>
                  <div className="flex flex-wrap gap-2">
                    {pillar.tags.map((tag, tIndex) => (
                      <span
                        key={tIndex}
                        className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-turquoise/10 text-turquoise"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

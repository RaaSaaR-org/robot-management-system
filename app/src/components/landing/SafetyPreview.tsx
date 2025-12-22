export function SafetyPreview() {
  return (
    <section id="safety" className="py-24 section-primary relative overflow-hidden">
      {/* Background effects */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-turquoise/5 to-transparent" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          {/* Content */}
          <div>
            <p className="text-turquoise font-mono text-sm mb-4 tracking-wider uppercase">
              Safety Simulation Preview
            </p>
            <h2 className="text-3xl sm:text-4xl font-bold text-theme-primary mb-6">
              Know Exactly What Will Happen
            </h2>
            <p className="text-theme-secondary text-lg mb-8">
              Before any drone takes off, any vehicle moves, or any robot acts — see a visual preview.
              Know exactly what will happen, then approve with confidence.
            </p>

            {/* Benefits */}
            <div className="space-y-4">
              <div className="flex items-start gap-4">
                <div className="w-8 h-8 rounded-lg bg-turquoise/20 flex items-center justify-center flex-shrink-0 mt-1">
                  <svg className="w-4 h-4 text-turquoise" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                </div>
                <div>
                  <h4 className="text-theme-primary font-medium mb-1">Visual Path Preview</h4>
                  <p className="text-theme-tertiary">See the exact path any device will take before it moves.</p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="w-8 h-8 rounded-lg bg-turquoise/20 flex items-center justify-center flex-shrink-0 mt-1">
                  <svg className="w-4 h-4 text-turquoise" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <div>
                  <h4 className="text-theme-primary font-medium mb-1">Hazard Detection</h4>
                  <p className="text-theme-tertiary">Identify hazards across all your autonomous devices automatically.</p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="w-8 h-8 rounded-lg bg-turquoise/20 flex items-center justify-center flex-shrink-0 mt-1">
                  <svg className="w-4 h-4 text-turquoise" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <h4 className="text-theme-primary font-medium mb-1">Confirm with Confidence</h4>
                  <p className="text-theme-tertiary">Approve actions only when you are certain they are safe.</p>
                </div>
              </div>
            </div>
          </div>

          {/* Preview Visual */}
          <div className="relative">
            <div className="aspect-video bg-theme-card rounded-2xl border border-theme overflow-hidden">
              {/* Simulated preview interface */}
              <div className="p-4 border-b border-theme flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <div className="w-3 h-3 rounded-full bg-turquoise" />
                    <div className="absolute inset-0 w-3 h-3 rounded-full bg-turquoise animate-ping" />
                  </div>
                  <span className="text-theme-secondary text-sm font-mono">Safety Preview Active</span>
                </div>
                {/* Animated countdown */}
                <div className="flex items-center gap-3">
                  <div className="w-24 h-1.5 bg-surface-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-turquoise to-cobalt rounded-full"
                      style={{ animation: 'countdown 4s linear infinite' }}
                    />
                  </div>
                  <span className="text-turquoise text-sm font-mono tabular-nums">SCANNING</span>
                </div>
              </div>

              <div className="p-4">
                {/* Visualization area */}
                <div className="aspect-video section-primary rounded-xl relative overflow-hidden">
                  {/* Animated Grid overlay */}
                  <div
                    className="absolute inset-0"
                    style={{
                      backgroundImage: 'linear-gradient(to right, rgba(42, 95, 255, 0.15) 1px, transparent 1px), linear-gradient(to bottom, rgba(42, 95, 255, 0.15) 1px, transparent 1px)',
                      backgroundSize: '32px 32px',
                      animation: 'gridPulse 3s ease-in-out infinite'
                    }}
                  />

                  {/* Scan line effect */}
                  <div
                    className="absolute inset-x-0 h-8 bg-gradient-to-b from-turquoise/20 via-turquoise/10 to-transparent pointer-events-none"
                    style={{ animation: 'scanLine 2.5s ease-in-out infinite' }}
                  />

                  {/* SVG for paths and animations */}
                  <svg className="absolute inset-0 w-full h-full" viewBox="0 0 400 225">
                    <defs>
                      {/* Path gradient */}
                      <linearGradient id="pathGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="#2A5FFF" />
                        <stop offset="100%" stopColor="#18E4C3" />
                      </linearGradient>
                      {/* Glow filter */}
                      <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
                        <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
                        <feMerge>
                          <feMergeNode in="coloredBlur"/>
                          <feMergeNode in="SourceGraphic"/>
                        </feMerge>
                      </filter>
                      {/* Obstacle zone gradient */}
                      <radialGradient id="dangerZone" cx="50%" cy="50%" r="50%">
                        <stop offset="0%" stopColor="#EF4444" stopOpacity="0.3" />
                        <stop offset="100%" stopColor="#EF4444" stopOpacity="0" />
                      </radialGradient>
                    </defs>

                    {/* Obstacle with danger zone */}
                    <circle cx="240" cy="90" r="35" fill="url(#dangerZone)" />
                    <rect x="225" y="75" width="30" height="30" rx="4" fill="#374151" stroke="#EF4444" strokeWidth="2" strokeDasharray="4 2" />
                    <text x="240" y="125" textAnchor="middle" fill="#EF4444" fontSize="8" fontFamily="monospace">OBSTACLE</text>

                    {/* Animated curved path avoiding obstacle */}
                    <path
                      d="M 60 140 Q 120 140 160 100 Q 200 60 280 60 Q 340 60 340 110"
                      fill="none"
                      stroke="url(#pathGradient)"
                      strokeWidth="3"
                      strokeLinecap="round"
                      filter="url(#glow)"
                      strokeDasharray="300"
                      style={{ animation: 'drawPath 3s ease-out infinite' }}
                    />

                    {/* Waypoints along path */}
                    <circle cx="120" cy="130" r="4" fill="#2A5FFF" opacity="0.6" />
                    <circle cx="180" cy="80" r="4" fill="#2A5FFF" opacity="0.6" />
                    <circle cx="280" cy="60" r="4" fill="#2A5FFF" opacity="0.6" />

                    {/* Target destination */}
                    <circle cx="340" cy="110" r="12" fill="none" stroke="#18E4C3" strokeWidth="2" opacity="0.5" />
                    <circle cx="340" cy="110" r="8" fill="none" stroke="#18E4C3" strokeWidth="2" opacity="0.7" />
                    <circle cx="340" cy="110" r="4" fill="#18E4C3" />

                    {/* Animated robot on path */}
                    <g style={{
                      offsetPath: "path('M 60 140 Q 120 140 160 100 Q 200 60 280 60 Q 340 60 340 110')",
                      animation: 'moveRobot 4s ease-in-out infinite'
                    }}>
                      {/* Radar sweep from robot */}
                      <g style={{ animation: 'radarSweep 2s linear infinite' }}>
                        <path d="M 0 0 L 25 -15 A 30 30 0 0 1 25 15 Z" fill="rgba(24, 228, 195, 0.15)" />
                      </g>
                      {/* Pulse rings */}
                      <circle cx="0" cy="0" r="12" fill="none" stroke="#18E4C3" strokeWidth="1" style={{ animation: 'pulseRing 2s ease-out infinite' }} />
                      <circle cx="0" cy="0" r="12" fill="none" stroke="#18E4C3" strokeWidth="1" style={{ animation: 'pulseRing 2s ease-out infinite 0.5s' }} />
                      {/* Robot body */}
                      <circle cx="0" cy="0" r="14" fill="#2A5FFF" />
                      <circle cx="0" cy="0" r="10" fill="#1a4ad4" />
                      {/* Robot icon */}
                      <rect x="-5" y="-5" width="10" height="10" rx="2" fill="white" opacity="0.9" />
                      <circle cx="-2" cy="-2" r="1.5" fill="#2A5FFF" />
                      <circle cx="2" cy="-2" r="1.5" fill="#2A5FFF" />
                      <rect x="-3" y="1" width="6" height="2" rx="1" fill="#2A5FFF" />
                    </g>

                    {/* Start position marker */}
                    <circle cx="60" cy="140" r="6" fill="none" stroke="#2A5FFF" strokeWidth="2" strokeDasharray="3 2" />
                    <text x="60" y="160" textAnchor="middle" fill="#2A5FFF" fontSize="8" fontFamily="monospace">START</text>

                    {/* End position marker */}
                    <text x="340" y="135" textAnchor="middle" fill="#18E4C3" fontSize="8" fontFamily="monospace">TARGET</text>
                  </svg>

                  {/* Real-time data overlay */}
                  <div className="absolute top-3 left-3 flex flex-col gap-1">
                    <div className="flex items-center gap-2 text-xs font-mono">
                      <span className="text-theme-muted">DIST:</span>
                      <span className="text-turquoise" style={{ animation: 'dataPulse 1s ease-in-out infinite' }}>2.4m</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs font-mono">
                      <span className="text-theme-muted">ETA:</span>
                      <span className="text-cobalt-300" style={{ animation: 'dataPulse 1s ease-in-out infinite 0.3s' }}>8.2s</span>
                    </div>
                  </div>

                  {/* Collision warning */}
                  <div className="absolute top-3 right-3 flex items-center gap-2 px-2 py-1 rounded bg-yellow-500/20 border border-yellow-500/30">
                    <div className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
                    <span className="text-yellow-400 text-xs font-mono">REROUTED</span>
                  </div>
                </div>
              </div>

              {/* Safety classification badges with staggered animation */}
              <div className="px-4 pb-4 flex flex-wrap gap-2">
                <span
                  className="px-3 py-1.5 rounded-full bg-green-500/20 text-green-400 text-xs font-medium flex items-center gap-1.5"
                  style={{ animation: 'fadeInUp 0.5s ease-out forwards', animationDelay: '0.5s', opacity: 0 }}
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                  Path Clear
                </span>
                <span
                  className="px-3 py-1.5 rounded-full bg-yellow-500/20 text-yellow-400 text-xs font-medium flex items-center gap-1.5"
                  style={{ animation: 'fadeInUp 0.5s ease-out forwards', animationDelay: '0.8s', opacity: 0 }}
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 9v2m0 4h.01" />
                  </svg>
                  1 Avoided
                </span>
                <span
                  className="px-3 py-1.5 rounded-full bg-turquoise/20 text-turquoise text-xs font-medium flex items-center gap-1.5"
                  style={{ animation: 'fadeInUp 0.5s ease-out forwards', animationDelay: '1.1s', opacity: 0 }}
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                  Safe to Execute
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

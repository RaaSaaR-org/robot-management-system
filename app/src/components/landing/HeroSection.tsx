export function HeroSection() {
  return (
    <section className="min-h-screen section-primary pt-16 flex items-center relative overflow-hidden">
      {/* Background gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-cobalt/20 via-transparent to-turquoise/10" />

      {/* Animated circles */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-cobalt/10 rounded-full blur-3xl animate-pulse" />
      <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-turquoise/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 relative z-10">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          {/* Text Content */}
          <div className="text-center lg:text-left">
            <p className="text-turquoise font-mono text-sm mb-4 tracking-wider uppercase">
              Your Autonomous Ecosystem
            </p>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-theme-primary leading-tight mb-6">
              Control All Your{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-cobalt to-turquoise">
                Autonomous Devices
              </span>
              {' '}— Naturally
            </h1>
            <p className="text-xl text-theme-secondary mb-8 max-w-xl mx-auto lg:mx-0">
              Whether it's robots in your warehouse, drones across your sites, or autonomous vehicles on the road —
              manage everything with one simple interface. Just like talking to a colleague.
            </p>

            {/* CTAs */}
            <div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start">
              <a href="/signup" className="btn-primary text-center">
                Get Started Free
              </a>
              <a href="#demo" className="btn-outline-white text-center flex items-center justify-center gap-2">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                </svg>
                Watch Demo
              </a>
            </div>

            {/* Trust badges */}
            <div className="mt-10 flex flex-wrap gap-3 justify-center lg:justify-start">
              <a
                href="https://github.com/robomindos"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-4 py-2 rounded-full bg-theme-card border border-theme hover:border-theme-hover transition-colors"
              >
                <svg className="w-5 h-5 text-theme-primary" fill="currentColor" viewBox="0 0 24 24">
                  <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
                </svg>
                <span className="font-medium text-theme-primary">Open Source</span>
              </a>
              <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-cobalt/10 border border-cobalt/30">
                <svg className="w-5 h-5 text-cobalt" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
                </svg>
                <span className="font-medium text-cobalt">Cloud Available</span>
              </div>
              <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-turquoise/10 border border-turquoise/30">
                <svg className="w-5 h-5 text-turquoise" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
                </svg>
                <span className="font-medium text-turquoise">Self-Hostable</span>
              </div>
            </div>
          </div>

          {/* Hero Visual - Fleet of Autonomous Devices */}
          <div className="relative">
            <div className="aspect-square max-w-lg mx-auto relative">
              {/* Connection lines and data flow (SVG) */}
              <svg className="absolute inset-0 w-full h-full" viewBox="0 0 400 400">
                <defs>
                  <linearGradient id="pulseGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#2A5FFF" stopOpacity="0.5" />
                    <stop offset="100%" stopColor="#18E4C3" stopOpacity="0.2" />
                  </linearGradient>
                  <linearGradient id="lineGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#2A5FFF" stopOpacity="0.3" />
                    <stop offset="100%" stopColor="#18E4C3" stopOpacity="0.15" />
                  </linearGradient>
                </defs>

                {/* Pulse rings from hub */}
                <circle cx="200" cy="200" r="45" fill="none" stroke="url(#pulseGradient)" strokeWidth="1" opacity="0">
                  <animate attributeName="r" values="45;130" dur="4s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.3;0" dur="4s" repeatCount="indefinite" />
                </circle>
                <circle cx="200" cy="200" r="45" fill="none" stroke="url(#pulseGradient)" strokeWidth="1" opacity="0">
                  <animate attributeName="r" values="45;130" dur="4s" repeatCount="indefinite" begin="2s" />
                  <animate attributeName="opacity" values="0.3;0" dur="4s" repeatCount="indefinite" begin="2s" />
                </circle>

                {/* Connection lines to 8 devices */}
                <line x1="200" y1="200" x2="200" y2="40" stroke="url(#lineGradient)" strokeWidth="1" />
                <line x1="200" y1="200" x2="320" y2="80" stroke="url(#lineGradient)" strokeWidth="1" />
                <line x1="200" y1="200" x2="360" y2="200" stroke="url(#lineGradient)" strokeWidth="1" />
                <line x1="200" y1="200" x2="320" y2="320" stroke="url(#lineGradient)" strokeWidth="1" />
                <line x1="200" y1="200" x2="200" y2="360" stroke="url(#lineGradient)" strokeWidth="1" />
                <line x1="200" y1="200" x2="80" y2="320" stroke="url(#lineGradient)" strokeWidth="1" />
                <line x1="200" y1="200" x2="40" y2="200" stroke="url(#lineGradient)" strokeWidth="1" />
                <line x1="200" y1="200" x2="80" y2="80" stroke="url(#lineGradient)" strokeWidth="1" />

                {/* Data packets traveling to devices (commands) */}
                <circle r="3" fill="#2A5FFF" opacity="0.8">
                  <animateMotion dur="2.5s" repeatCount="indefinite" path="M200,200 L200,40" />
                </circle>
                <circle r="3" fill="#2A5FFF" opacity="0.8">
                  <animateMotion dur="2.5s" repeatCount="indefinite" path="M200,200 L320,80" begin="0.3s" />
                </circle>
                <circle r="3" fill="#2A5FFF" opacity="0.8">
                  <animateMotion dur="2.5s" repeatCount="indefinite" path="M200,200 L360,200" begin="0.6s" />
                </circle>
                <circle r="3" fill="#2A5FFF" opacity="0.8">
                  <animateMotion dur="2.5s" repeatCount="indefinite" path="M200,200 L320,320" begin="0.9s" />
                </circle>
                <circle r="3" fill="#2A5FFF" opacity="0.8">
                  <animateMotion dur="2.5s" repeatCount="indefinite" path="M200,200 L200,360" begin="1.2s" />
                </circle>
                <circle r="3" fill="#2A5FFF" opacity="0.8">
                  <animateMotion dur="2.5s" repeatCount="indefinite" path="M200,200 L80,320" begin="1.5s" />
                </circle>
                <circle r="3" fill="#2A5FFF" opacity="0.8">
                  <animateMotion dur="2.5s" repeatCount="indefinite" path="M200,200 L40,200" begin="1.8s" />
                </circle>
                <circle r="3" fill="#2A5FFF" opacity="0.8">
                  <animateMotion dur="2.5s" repeatCount="indefinite" path="M200,200 L80,80" begin="2.1s" />
                </circle>

                {/* Telemetry coming back from devices */}
                <circle r="2" fill="#18E4C3" opacity="0.7">
                  <animateMotion dur="3s" repeatCount="indefinite" path="M200,40 L200,200" begin="1s" />
                </circle>
                <circle r="2" fill="#18E4C3" opacity="0.7">
                  <animateMotion dur="3s" repeatCount="indefinite" path="M360,200 L200,200" begin="1.5s" />
                </circle>
                <circle r="2" fill="#18E4C3" opacity="0.7">
                  <animateMotion dur="3s" repeatCount="indefinite" path="M200,360 L200,200" begin="0.5s" />
                </circle>
                <circle r="2" fill="#18E4C3" opacity="0.7">
                  <animateMotion dur="3s" repeatCount="indefinite" path="M40,200 L200,200" begin="2s" />
                </circle>
                <circle r="2" fill="#18E4C3" opacity="0.7">
                  <animateMotion dur="3s" repeatCount="indefinite" path="M320,320 L200,200" begin="0.8s" />
                </circle>
                <circle r="2" fill="#18E4C3" opacity="0.7">
                  <animateMotion dur="3s" repeatCount="indefinite" path="M80,80 L200,200" begin="1.8s" />
                </circle>
              </svg>

              {/* Central Hub */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-20 h-20 z-10">
                <div className="absolute inset-0 rounded-full bg-gradient-to-br from-cobalt/30 to-turquoise/30 blur-xl" />
                <div className="relative w-full h-full rounded-full bg-gradient-to-br from-cobalt to-turquoise p-[2px] shadow-2xl shadow-cobalt/30">
                  <div className="w-full h-full rounded-full bg-gradient-to-br from-cobalt/95 to-turquoise/95 flex items-center justify-center">
                    <div className="text-center">
                      <span className="text-white font-bold text-base">R</span>
                      <p className="text-white/70 text-[8px] font-mono tracking-wider">HUB</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* === 8 DEVICES === */}

              {/* Drone 1 - Top */}
              <div className="absolute top-0 left-1/2 -translate-x-1/2" style={{ animation: 'droneHover 5s ease-in-out infinite' }}>
                <div className="w-11 h-11 rounded-lg bg-theme-card border border-cobalt/30 backdrop-blur flex items-center justify-center shadow-lg">
                  <svg className="w-5 h-5 text-cobalt" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <circle cx="12" cy="12" r="2" />
                    <circle cx="5" cy="5" r="2" />
                    <circle cx="19" cy="5" r="2" />
                    <circle cx="5" cy="19" r="2" />
                    <circle cx="19" cy="19" r="2" />
                    <line x1="10" y1="10" x2="6.5" y2="6.5" />
                    <line x1="14" y1="10" x2="17.5" y2="6.5" />
                    <line x1="10" y1="14" x2="6.5" y2="17.5" />
                    <line x1="14" y1="14" x2="17.5" y2="17.5" />
                  </svg>
                </div>
                <p className="text-theme-muted text-[8px] text-center mt-0.5 font-mono">Drone</p>
              </div>

              {/* AGV - Top Right */}
              <div className="absolute top-[8%] right-[8%]">
                <div className="w-11 h-11 rounded-lg bg-theme-card border border-turquoise/30 backdrop-blur flex items-center justify-center shadow-lg">
                  <svg className="w-5 h-5 text-turquoise" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <rect x="4" y="10" width="12" height="8" rx="1" />
                    <circle cx="7" cy="18" r="2" />
                    <circle cx="13" cy="18" r="2" />
                    <path d="M16 14h4l1 4h-5" />
                    <path d="M8 10V6h6v4" />
                  </svg>
                </div>
                <p className="text-theme-muted text-[8px] text-center mt-0.5 font-mono">AGV</p>
              </div>

              {/* Autonomous Vehicle - Right */}
              <div className="absolute right-0 top-1/2 -translate-y-1/2">
                <div className="w-11 h-11 rounded-lg bg-theme-card border border-cobalt/30 backdrop-blur flex items-center justify-center shadow-lg">
                  <svg className="w-5 h-5 text-cobalt" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M5 11l1.5-4.5a2 2 0 011.9-1.5h7.2a2 2 0 011.9 1.5L19 11" />
                    <path d="M5 11h14v5a1 1 0 01-1 1H6a1 1 0 01-1-1v-5z" />
                    <circle cx="7.5" cy="15.5" r="1.5" />
                    <circle cx="16.5" cy="15.5" r="1.5" />
                    <path d="M9 8h6" />
                    <path d="M12 3v2" />
                  </svg>
                </div>
                <p className="text-theme-muted text-[8px] text-center mt-0.5 font-mono">AV</p>
              </div>

              {/* Robot Arm - Bottom Right */}
              <div className="absolute bottom-[8%] right-[8%]">
                <div className="w-11 h-11 rounded-lg bg-theme-card border border-turquoise/30 backdrop-blur flex items-center justify-center shadow-lg">
                  <svg className="w-5 h-5 text-turquoise" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <rect x="4" y="18" width="6" height="4" rx="1" />
                    <path d="M7 18v-4" />
                    <path d="M7 14l5-5" />
                    <path d="M12 9l4 2" />
                    <circle cx="16" cy="11" r="2" />
                    <path d="M18 11l2-1" />
                  </svg>
                </div>
                <p className="text-theme-muted text-[8px] text-center mt-0.5 font-mono">Arm</p>
              </div>

              {/* Humanoid Robot - Bottom */}
              <div className="absolute bottom-0 left-1/2 -translate-x-1/2" style={{ animation: 'robotReady 3s ease-in-out infinite' }}>
                <div className="w-11 h-11 rounded-lg bg-theme-card border border-cobalt/30 backdrop-blur flex items-center justify-center shadow-lg">
                  <svg className="w-5 h-5 text-cobalt" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <rect x="9" y="2" width="6" height="5" rx="1" />
                    <circle cx="10.5" cy="4" r="0.5" fill="currentColor" />
                    <circle cx="13.5" cy="4" r="0.5" fill="currentColor" />
                    <rect x="8" y="8" width="8" height="8" rx="1" />
                    <line x1="8" y1="10" x2="5" y2="14" />
                    <line x1="16" y1="10" x2="19" y2="14" />
                    <line x1="10" y1="16" x2="10" y2="21" />
                    <line x1="14" y1="16" x2="14" y2="21" />
                  </svg>
                </div>
                <p className="text-theme-muted text-[8px] text-center mt-0.5 font-mono">Humanoid</p>
              </div>

              {/* Delivery Bot - Bottom Left */}
              <div className="absolute bottom-[8%] left-[8%]">
                <div className="w-11 h-11 rounded-lg bg-theme-card border border-turquoise/30 backdrop-blur flex items-center justify-center shadow-lg">
                  <svg className="w-5 h-5 text-turquoise" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <rect x="6" y="8" width="12" height="8" rx="2" />
                    <circle cx="8" cy="18" r="2" />
                    <circle cx="16" cy="18" r="2" />
                    <rect x="9" y="5" width="6" height="3" rx="1" />
                    <circle cx="10.5" cy="11" r="1" fill="currentColor" />
                    <circle cx="13.5" cy="11" r="1" fill="currentColor" />
                  </svg>
                </div>
                <p className="text-theme-muted text-[8px] text-center mt-0.5 font-mono">Delivery</p>
              </div>

              {/* Second Robot Arm - Left */}
              <div className="absolute left-0 top-1/2 -translate-y-1/2">
                <div className="w-11 h-11 rounded-lg bg-theme-card border border-cobalt/30 backdrop-blur flex items-center justify-center shadow-lg">
                  <svg className="w-5 h-5 text-cobalt" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <rect x="4" y="18" width="6" height="4" rx="1" />
                    <path d="M7 18v-4" />
                    <path d="M7 14l5-5" />
                    <path d="M12 9l4 2" />
                    <circle cx="16" cy="11" r="2" />
                    <path d="M18 11l2-1" />
                  </svg>
                </div>
                <p className="text-theme-muted text-[8px] text-center mt-0.5 font-mono">Arm</p>
              </div>

              {/* Drone 2 - Top Left */}
              <div className="absolute top-[8%] left-[8%]" style={{ animation: 'droneHover 6s ease-in-out infinite', animationDelay: '1s' }}>
                <div className="w-11 h-11 rounded-lg bg-theme-card border border-turquoise/30 backdrop-blur flex items-center justify-center shadow-lg">
                  <svg className="w-5 h-5 text-turquoise" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <circle cx="12" cy="12" r="2" />
                    <circle cx="5" cy="5" r="2" />
                    <circle cx="19" cy="5" r="2" />
                    <circle cx="5" cy="19" r="2" />
                    <circle cx="19" cy="19" r="2" />
                    <line x1="10" y1="10" x2="6.5" y2="6.5" />
                    <line x1="14" y1="10" x2="17.5" y2="6.5" />
                    <line x1="10" y1="14" x2="6.5" y2="17.5" />
                    <line x1="14" y1="14" x2="17.5" y2="17.5" />
                  </svg>
                </div>
                <p className="text-theme-muted text-[8px] text-center mt-0.5 font-mono">Drone</p>
              </div>

              {/* Ambient glow */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-44 h-44 bg-cobalt/10 rounded-full blur-3xl" />
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-28 h-28 bg-turquoise/10 rounded-full blur-2xl" />
            </div>

            {/* Industries - Prominent display below illustration */}
            <div className="flex justify-center gap-3 mt-6">
              <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-cobalt/10 to-cobalt/5 border border-cobalt/20">
                <svg className="w-4 h-4 text-cobalt" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 00-10.026 0 1.106 1.106 0 00-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" />
                </svg>
                <span className="text-sm font-medium text-cobalt">Logistics</span>
              </div>
              <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-turquoise/10 to-turquoise/5 border border-turquoise/20">
                <svg className="w-4 h-4 text-turquoise" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
                </svg>
                <span className="text-sm font-medium text-turquoise">Manufacturing</span>
              </div>
              <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-cobalt/10 to-turquoise/10 border border-cobalt/20">
                <svg className="w-4 h-4 text-cobalt" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
                </svg>
                <span className="text-sm font-medium bg-gradient-to-r from-cobalt to-turquoise bg-clip-text text-transparent">Healthcare</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

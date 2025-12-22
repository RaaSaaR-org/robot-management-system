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

          {/* Hero Visual - Device Ecosystem Constellation */}
          <div className="relative">
            <div className="aspect-square max-w-lg mx-auto relative">
              {/* Connection lines (SVG) */}
              <svg className="absolute inset-0 w-full h-full" viewBox="0 0 400 400">
                <defs>
                  <linearGradient id="lineGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#2A5FFF" stopOpacity="0.4" />
                    <stop offset="100%" stopColor="#18E4C3" stopOpacity="0.4" />
                  </linearGradient>
                </defs>
                {/* Cardinal direction lines */}
                <line x1="200" y1="200" x2="200" y2="50" stroke="url(#lineGradient)" strokeWidth="2" strokeDasharray="6 4">
                  <animate attributeName="stroke-dashoffset" from="0" to="10" dur="1s" repeatCount="indefinite" />
                </line>
                <line x1="200" y1="200" x2="350" y2="200" stroke="url(#lineGradient)" strokeWidth="2" strokeDasharray="6 4">
                  <animate attributeName="stroke-dashoffset" from="0" to="10" dur="1s" repeatCount="indefinite" />
                </line>
                <line x1="200" y1="200" x2="200" y2="350" stroke="url(#lineGradient)" strokeWidth="2" strokeDasharray="6 4">
                  <animate attributeName="stroke-dashoffset" from="0" to="10" dur="1s" repeatCount="indefinite" />
                </line>
                <line x1="200" y1="200" x2="50" y2="200" stroke="url(#lineGradient)" strokeWidth="2" strokeDasharray="6 4">
                  <animate attributeName="stroke-dashoffset" from="0" to="10" dur="1s" repeatCount="indefinite" />
                </line>
                {/* Diagonal lines */}
                <line x1="200" y1="200" x2="320" y2="80" stroke="url(#lineGradient)" strokeWidth="2" strokeDasharray="6 4">
                  <animate attributeName="stroke-dashoffset" from="0" to="10" dur="1.2s" repeatCount="indefinite" />
                </line>
                <line x1="200" y1="200" x2="320" y2="320" stroke="url(#lineGradient)" strokeWidth="2" strokeDasharray="6 4">
                  <animate attributeName="stroke-dashoffset" from="0" to="10" dur="1.2s" repeatCount="indefinite" />
                </line>
                <line x1="200" y1="200" x2="80" y2="320" stroke="url(#lineGradient)" strokeWidth="2" strokeDasharray="6 4">
                  <animate attributeName="stroke-dashoffset" from="0" to="10" dur="1.2s" repeatCount="indefinite" />
                </line>
                <line x1="200" y1="200" x2="80" y2="80" stroke="url(#lineGradient)" strokeWidth="2" strokeDasharray="6 4">
                  <animate attributeName="stroke-dashoffset" from="0" to="10" dur="1.2s" repeatCount="indefinite" />
                </line>
                {/* Data pulse dots */}
                <circle r="4" fill="#2A5FFF">
                  <animateMotion dur="2s" repeatCount="indefinite" path="M200,200 L200,50" />
                </circle>
                <circle r="4" fill="#18E4C3">
                  <animateMotion dur="2s" repeatCount="indefinite" path="M200,200 L350,200" begin="0.5s" />
                </circle>
                <circle r="4" fill="#2A5FFF">
                  <animateMotion dur="2s" repeatCount="indefinite" path="M200,200 L320,80" begin="0.3s" />
                </circle>
                <circle r="4" fill="#18E4C3">
                  <animateMotion dur="2s" repeatCount="indefinite" path="M200,200 L80,320" begin="0.8s" />
                </circle>
              </svg>

              {/* Rotating outer ring */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-36 h-36 rounded-full border-2 border-dashed border-cobalt/20 animate-spin" style={{ animationDuration: '20s' }} />
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-44 h-44 rounded-full border border-turquoise/10 animate-spin" style={{ animationDuration: '30s', animationDirection: 'reverse' }} />

              {/* Central Hub */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 rounded-full bg-gradient-to-br from-cobalt to-turquoise p-1 shadow-2xl shadow-cobalt/40 z-10">
                <div className="w-full h-full rounded-full bg-gradient-to-br from-cobalt/90 to-turquoise/90 flex items-center justify-center">
                  <div className="text-center">
                    <span className="text-white font-bold text-2xl">R</span>
                    <p className="text-white/80 text-xs font-mono tracking-wider">HUB</p>
                  </div>
                </div>
              </div>

              {/* Drone - Top */}
              <div className="absolute top-2 left-1/2 -translate-x-1/2" style={{ animation: 'float 4s ease-in-out infinite' }}>
                <div className="w-14 h-14 rounded-xl bg-theme-card border border-cobalt/30 backdrop-blur flex items-center justify-center shadow-lg hover:scale-110 transition-transform">
                  <svg className="w-7 h-7 text-cobalt" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                </div>
                <p className="text-theme-muted text-[10px] text-center mt-1 font-mono">Drone</p>
              </div>

              {/* Facility - Top Right */}
              <div className="absolute top-[12%] right-[12%]" style={{ animation: 'float 4.5s ease-in-out infinite', animationDelay: '0.5s' }}>
                <div className="w-14 h-14 rounded-xl bg-theme-card border border-turquoise/30 backdrop-blur flex items-center justify-center shadow-lg hover:scale-110 transition-transform">
                  <svg className="w-7 h-7 text-turquoise" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                  </svg>
                </div>
                <p className="text-theme-muted text-[10px] text-center mt-1 font-mono">Facility</p>
              </div>

              {/* Vehicle - Right */}
              <div className="absolute right-2 top-1/2 -translate-y-1/2" style={{ animation: 'float 3.8s ease-in-out infinite', animationDelay: '1s' }}>
                <div className="w-14 h-14 rounded-xl bg-theme-card border border-cobalt/30 backdrop-blur flex items-center justify-center shadow-lg hover:scale-110 transition-transform">
                  <svg className="w-7 h-7 text-cobalt" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 17h.01M16 17h.01M9 11h6M5 11l1.5-4.5A2 2 0 018.4 5h7.2a2 2 0 011.9 1.5L19 11M5 11h14M5 11v6a1 1 0 001 1h1m12-7v6a1 1 0 01-1 1h-1M7 18a1 1 0 100-2 1 1 0 000 2zm10 0a1 1 0 100-2 1 1 0 000 2z" />
                  </svg>
                </div>
                <p className="text-theme-muted text-[10px] text-center mt-1 font-mono">Vehicle</p>
              </div>

              {/* Forklift - Bottom Right */}
              <div className="absolute bottom-[12%] right-[12%]" style={{ animation: 'float 4.2s ease-in-out infinite', animationDelay: '1.5s' }}>
                <div className="w-14 h-14 rounded-xl bg-theme-card border border-turquoise/30 backdrop-blur flex items-center justify-center shadow-lg hover:scale-110 transition-transform">
                  <svg className="w-7 h-7 text-turquoise" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                  </svg>
                </div>
                <p className="text-theme-muted text-[10px] text-center mt-1 font-mono">Logistics</p>
              </div>

              {/* Robot - Bottom */}
              <div className="absolute bottom-2 left-1/2 -translate-x-1/2" style={{ animation: 'float 4.4s ease-in-out infinite', animationDelay: '2s' }}>
                <div className="w-14 h-14 rounded-xl bg-theme-card border border-cobalt/30 backdrop-blur flex items-center justify-center shadow-lg hover:scale-110 transition-transform">
                  <svg className="w-7 h-7 text-cobalt" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                  </svg>
                </div>
                <p className="text-theme-muted text-[10px] text-center mt-1 font-mono">Robot</p>
              </div>

              {/* Security - Bottom Left */}
              <div className="absolute bottom-[12%] left-[12%]" style={{ animation: 'float 3.9s ease-in-out infinite', animationDelay: '2.5s' }}>
                <div className="w-14 h-14 rounded-xl bg-theme-card border border-turquoise/30 backdrop-blur flex items-center justify-center shadow-lg hover:scale-110 transition-transform">
                  <svg className="w-7 h-7 text-turquoise" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                </div>
                <p className="text-theme-muted text-[10px] text-center mt-1 font-mono">Security</p>
              </div>

              {/* Delivery - Left */}
              <div className="absolute left-2 top-1/2 -translate-y-1/2" style={{ animation: 'float 4.1s ease-in-out infinite', animationDelay: '3s' }}>
                <div className="w-14 h-14 rounded-xl bg-theme-card border border-cobalt/30 backdrop-blur flex items-center justify-center shadow-lg hover:scale-110 transition-transform">
                  <svg className="w-7 h-7 text-cobalt" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                  </svg>
                </div>
                <p className="text-theme-muted text-[10px] text-center mt-1 font-mono">Delivery</p>
              </div>

              {/* Medical - Top Left */}
              <div className="absolute top-[12%] left-[12%]" style={{ animation: 'float 4.3s ease-in-out infinite', animationDelay: '3.5s' }}>
                <div className="w-14 h-14 rounded-xl bg-theme-card border border-turquoise/30 backdrop-blur flex items-center justify-center shadow-lg hover:scale-110 transition-transform">
                  <svg className="w-7 h-7 text-turquoise" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                  </svg>
                </div>
                <p className="text-theme-muted text-[10px] text-center mt-1 font-mono">Medical</p>
              </div>

              {/* Ambient glow */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-56 h-56 bg-cobalt/15 rounded-full blur-3xl" />
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-40 h-40 bg-turquoise/15 rounded-full blur-2xl animate-pulse" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

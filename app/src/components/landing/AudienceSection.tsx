const useCases = [
  {
    industry: 'Manufacturing & Logistics',
    description: 'Orchestrate warehouse robots, AGVs, and sorting systems from a single dashboard.',
    benefit: 'Reduce downtime with real-time fleet monitoring and predictive alerts.',
    icon: (
      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
      </svg>
    ),
  },
  {
    industry: 'Healthcare & Medical',
    description: 'Manage hospital delivery robots, disinfection units, and patient transport systems.',
    benefit: 'Ensure compliance with full audit trails and role-based access control.',
    icon: (
      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
      </svg>
    ),
  },
  {
    industry: 'Construction & Mining',
    description: 'Control autonomous excavators, surveying drones, and safety monitoring robots.',
    benefit: 'Boost site safety with remote operation and hazard detection integration.',
    icon: (
      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
      </svg>
    ),
  },
  {
    industry: 'Agriculture & Energy',
    description: 'Coordinate crop-monitoring drones, harvesting robots, and solar panel inspectors.',
    benefit: 'Maximize yield with AI-powered scheduling and environmental sensors.',
    icon: (
      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
      </svg>
    ),
  },
  {
    industry: 'Small Business',
    description: 'Simple, affordable control for small fleets—delivery bots, cleaning robots, security patrols.',
    benefit: 'Enterprise features without enterprise complexity.',
    icon: (
      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
      </svg>
    ),
  },
  {
    industry: 'Individual & Research',
    description: 'Perfect for hobbyists, researchers, and developers building the next generation of robotics.',
    benefit: 'Open source flexibility with professional-grade tools.',
    icon: (
      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
      </svg>
    ),
  },
];

export function AudienceSection() {
  return (
    <section className="py-24 section-secondary">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="text-center mb-16">
          <p className="text-cobalt font-mono text-sm mb-4 tracking-wider uppercase">
            Industry Solutions
          </p>
          <h2 className="text-3xl sm:text-4xl font-bold text-theme-primary mb-4">
            Built for Managing Robots
          </h2>
          <p className="text-theme-secondary text-lg max-w-2xl mx-auto">
            From factory floors to hospital corridors — RoboMindOS adapts to your operational needs.
          </p>
        </div>

        {/* Use Case Cards - First Row (3 cards) */}
        <div className="grid md:grid-cols-3 gap-6 mb-6">
          {useCases.slice(0, 3).map((useCase, index) => (
            <div
              key={index}
              className="card p-6 hover:shadow-lg transition-all duration-300 group"
            >
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-cobalt/10 to-turquoise/10 text-cobalt flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                {useCase.icon}
              </div>
              <div className="mb-4">
                <h3 className="text-lg font-semibold text-theme-primary">
                  {useCase.industry}
                </h3>
              </div>
              <p className="text-theme-secondary text-sm mb-4">
                {useCase.description}
              </p>
              <p className="text-sm text-turquoise font-medium border-l-2 border-turquoise pl-3">
                {useCase.benefit}
              </p>
            </div>
          ))}
        </div>

        {/* Use Case Cards - Second Row (3 cards) */}
        <div className="grid md:grid-cols-3 gap-6">
          {useCases.slice(3, 6).map((useCase, index) => (
            <div
              key={index + 3}
              className="card p-6 hover:shadow-lg transition-all duration-300 group"
            >
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-cobalt/10 to-turquoise/10 text-cobalt flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                {useCase.icon}
              </div>
              <div className="mb-4">
                <h3 className="text-lg font-semibold text-theme-primary">
                  {useCase.industry}
                </h3>
              </div>
              <p className="text-theme-secondary text-sm mb-4">
                {useCase.description}
              </p>
              <p className="text-sm text-turquoise font-medium border-l-2 border-turquoise pl-3">
                {useCase.benefit}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

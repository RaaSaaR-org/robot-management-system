/**
 * @file AdvantagesSection.tsx
 * @description Section highlighting competitive advantages of RoboMindOS
 * @feature landing
 */

const advantages = [
  {
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
        />
      </svg>
    ),
    title: 'EU AI Act Ready',
    description:
      'Built-in compliance logging with tamper-evident audit trails. GDPR-compliant data retention and legal hold capabilities. Technical documentation per AI Act Annex IV.',
    highlights: ['Tamper-evident audit trails', 'Legal hold support', 'Annex IV documentation'],
  },
  {
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
        />
      </svg>
    ),
    title: 'Vision-Language-Action Training',
    description:
      'Train custom skills from demonstration data. Deploy models across your entire fleet. Build a skill library for reusable, shareable behaviors.',
    highlights: ['Train from demonstrations', 'Fleet-wide deployment', 'Reusable skill library'],
  },
  {
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
        />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
        />
      </svg>
    ),
    title: 'AI Decision Transparency',
    description:
      'Understand every AI decision your robots make. Confidence metrics and factor analysis provide full visibility. Complete audit trail for accountability.',
    highlights: ['Decision explanations', 'Confidence metrics', 'Full audit trail'],
  },
  {
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
        />
      </svg>
    ),
    title: 'Scale Without Limits',
    description:
      'From 1 robot to 1,000+ devices. Choose self-hosted for full control or managed cloud for convenience. Open source core with enterprise support available.',
    highlights: ['1 to 1,000+ robots', 'Self-hosted or cloud', 'Open source core'],
  },
];

export function AdvantagesSection() {
  return (
    <section className="py-24 section-primary">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="text-center mb-16">
          <p className="text-turquoise font-mono text-sm mb-4 tracking-wider uppercase">
            Why RoboMindOS
          </p>
          <h2 className="text-3xl sm:text-4xl font-bold text-theme-primary mb-4">
            Built for the Future of Robotics
          </h2>
          <p className="text-theme-secondary text-lg max-w-2xl mx-auto">
            The only platform that combines regulatory compliance, advanced AI training, and
            enterprise scalability — all in one open source solution.
          </p>
        </div>

        {/* Advantages Grid */}
        <div className="grid md:grid-cols-2 gap-8">
          {advantages.map((advantage, index) => (
            <div
              key={index}
              className="card p-8 hover:shadow-lg border-l-4 border-l-transparent hover:border-l-cobalt transition-all duration-300"
            >
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cobalt/10 to-turquoise/10 text-cobalt flex items-center justify-center flex-shrink-0">
                  {advantage.icon}
                </div>
                <div className="flex-1">
                  <h3 className="text-xl font-semibold text-theme-primary mb-3">
                    {advantage.title}
                  </h3>
                  <p className="text-theme-secondary mb-4">{advantage.description}</p>
                  <div className="flex flex-wrap gap-2">
                    {advantage.highlights.map((highlight, hIndex) => (
                      <span
                        key={hIndex}
                        className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-cobalt/10 text-cobalt"
                      >
                        {highlight}
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

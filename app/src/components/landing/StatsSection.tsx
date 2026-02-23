const stats = [
  {
    value: 'MIT',
    label: 'Open Source',
    description: 'Fully open-source under MIT License',
  },
  {
    value: 'A2A',
    label: 'Protocol',
    description: 'Agent-to-Agent fleet communication',
  },
  {
    value: '3+',
    label: 'VLA Models',
    description: 'pi0, OpenVLA, GR00T supported',
  },
  {
    value: 'EU AI Act',
    label: 'Compliant',
    description: 'Built-in audit logging and explainability',
  },
];

export function StatsSection() {
  return (
    <section className="py-20 section-tertiary">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-12">
          {stats.map((stat, index) => (
            <div key={index} className="text-center">
              <div className="text-4xl sm:text-5xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-cobalt to-turquoise mb-2">
                {stat.value}
              </div>
              <div className="text-theme-primary font-semibold mb-1">
                {stat.label}
              </div>
              <div className="text-theme-muted text-xs sm:text-sm">
                {stat.description}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

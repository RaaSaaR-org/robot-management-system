const stats = [
  {
    value: '10,000+',
    label: 'Robots Managed',
    description: 'Across home and enterprise deployments',
  },
  {
    value: '99.9%',
    label: 'Uptime',
    description: 'Enterprise-grade reliability',
  },
  {
    value: '98.5%',
    label: 'Task Completion',
    description: 'Successfully executed commands',
  },
  {
    value: '<100ms',
    label: 'E-Stop Response',
    description: 'Instant emergency halt capability',
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
              <div className="text-theme-muted text-sm">
                {stat.description}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

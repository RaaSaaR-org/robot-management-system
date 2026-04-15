const features = [
  {
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
    title: 'Fleet Operations',
    description: 'Monitor and control your robot fleet in real-time. Status, telemetry, safety controls, emergency stop — all in one dashboard.',
    badge: 'Core',
  },
  {
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
      </svg>
    ),
    title: 'Natural Language Control',
    description: 'Talk to your robots. A2A Protocol with VLA inference enables natural language task execution — just describe what you want done.',
    badge: 'AI',
  },
  {
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
      </svg>
    ),
    title: 'Data Collection',
    description: 'Record demonstrations via teleoperation, kinesthetic teaching, or VR. LeRobotDataset compatible, HuggingFace Hub sync built-in.',
    badge: 'Training',
  },
  {
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
      </svg>
    ),
    title: 'Dataset Hub',
    description: 'Manage, version, and share training datasets. Browse episodes, check quality scores, upload to HuggingFace Hub with one click.',
    badge: 'Training',
  },
  {
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
      </svg>
    ),
    title: 'Training Studio',
    description: 'Fine-tune VLA models with one click. Support for Pi0, ACT, Diffusion Policy, OpenVLA. Track experiments and artifacts in the built-in model registry.',
    badge: 'Training',
  },
  {
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
      </svg>
    ),
    title: 'Model Registry',
    description: 'Track every model version. Deploy with canary rollouts, run A/B tests, roll back instantly. Know exactly what runs on which robot.',
    badge: 'Deployment',
  },
  {
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
      </svg>
    ),
    title: 'Evaluation',
    description: 'Measure real-world success rates. Replay failed episodes, analyze errors, compare model versions. Close the training feedback loop.',
    badge: 'Evaluation',
  },
  {
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
      </svg>
    ),
    title: 'EU AI Act Compliance',
    description: 'Built-in compliance logging, decision audit trails, and risk classification. Be ready for the August 2026 deadline — by design.',
    badge: 'Compliance',
  },
];

export function FeatureSection() {
  return (
    <section id="features" className="py-24 section-secondary">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="text-center mb-16">
          <p className="text-cobalt font-mono text-sm mb-4 tracking-wider uppercase">
            One Toolchain
          </p>
          <h2 className="text-3xl sm:text-4xl font-bold text-theme-primary mb-3">
            Everything you need, built in
          </h2>
          <p className="text-theme-secondary text-lg max-w-2xl mx-auto">
            Eight focused tools that snap together to form the complete Physical AI
            lifecycle — no duct tape, no gaps.
          </p>
        </div>

        {/* Feature Grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          {features.map((feature, index) => (
            <div
              key={index}
              className="card p-6 hover:shadow-lg"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="w-12 h-12 rounded-xl bg-cobalt/10 text-cobalt flex items-center justify-center">
                  {feature.icon}
                </div>
                {feature.badge && (
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-cobalt/10 text-cobalt">
                    {feature.badge}
                  </span>
                )}
              </div>
              <h3 className="text-lg font-semibold text-theme-primary mb-2">
                {feature.title}
              </h3>
              <p className="text-theme-secondary text-sm">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

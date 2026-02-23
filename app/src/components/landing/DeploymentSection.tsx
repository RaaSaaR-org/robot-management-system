/**
 * @file DeploymentSection.tsx
 * @description Deployment options for NeoDEM — self-hosted and Kubernetes
 * @feature landing
 */

export function DeploymentSection() {
  return (
    <section id="deploy" className="py-20 section-tertiary">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="text-center mb-12">
          <p className="text-cobalt font-mono text-sm mb-4 tracking-wider uppercase">
            Open Source & Self-Hosted
          </p>
          <h2 className="text-3xl sm:text-4xl font-bold text-theme-primary mb-4">
            Deploy Your Way
          </h2>
          <p className="text-theme-secondary text-lg max-w-2xl mx-auto">
            NeoDEM is open source at its core. Run it on a Raspberry Pi for development,
            Docker for production, or Kubernetes for fleet-scale operations.
          </p>
        </div>

        {/* Deployment Options — 3 columns */}
        <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
          {/* Raspberry Pi / Dev */}
          <div className="card p-8 text-center hover:shadow-lg transition-all">
            <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-cobalt/10 to-turquoise/10 flex items-center justify-center">
              <svg className="w-8 h-8 text-cobalt" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <h3 className="text-xl font-semibold text-theme-primary mb-3">Raspberry Pi</h3>
            <p className="text-theme-secondary mb-6">
              Perfect for developers and researchers. Run the full stack on a single board.
            </p>
            <ul className="text-left space-y-3 mb-6">
              <li className="flex items-center gap-3 text-theme-secondary">
                <svg className="w-5 h-5 text-turquoise flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span>Quick local setup</span>
              </li>
              <li className="flex items-center gap-3 text-theme-secondary">
                <svg className="w-5 h-5 text-turquoise flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span>SQLite — no external DB</span>
              </li>
              <li className="flex items-center gap-3 text-theme-secondary">
                <svg className="w-5 h-5 text-turquoise flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span>Ideal for prototyping</span>
              </li>
            </ul>
            <a
              href="https://github.com/RaaSaaR-org/robot-management-system"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-outline-white inline-flex items-center gap-2"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
              </svg>
              Get Started
            </a>
          </div>

          {/* Docker / Self-Hosted */}
          <div className="card p-8 text-center hover:shadow-lg transition-all border-cobalt/30">
            <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-cobalt/20 to-turquoise/20 flex items-center justify-center">
              <svg className="w-8 h-8 text-cobalt" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
              </svg>
            </div>
            <h3 className="text-xl font-semibold text-theme-primary mb-3">Docker / Self-Hosted</h3>
            <p className="text-theme-secondary mb-6">
              Full control over your data. Deploy on your own infrastructure with Docker Compose.
            </p>
            <ul className="text-left space-y-3 mb-6">
              <li className="flex items-center gap-3 text-theme-secondary">
                <svg className="w-5 h-5 text-turquoise flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span>Complete data ownership</span>
              </li>
              <li className="flex items-center gap-3 text-theme-secondary">
                <svg className="w-5 h-5 text-turquoise flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span>PostgreSQL + full stack</span>
              </li>
              <li className="flex items-center gap-3 text-theme-secondary">
                <svg className="w-5 h-5 text-turquoise flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span>Production-ready</span>
              </li>
            </ul>
            <a
              href="https://github.com/RaaSaaR-org/robot-management-system"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-outline-white inline-flex items-center gap-2"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
              </svg>
              View on GitHub
            </a>
          </div>

          {/* Kubernetes */}
          <div className="card p-8 text-center hover:shadow-lg transition-all relative">
            <div className="absolute top-4 right-4">
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-turquoise/10 text-turquoise border border-turquoise/30">
                Coming Soon
              </span>
            </div>
            <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-cobalt/10 to-turquoise/10 flex items-center justify-center">
              <svg className="w-8 h-8 text-turquoise" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
              </svg>
            </div>
            <h3 className="text-xl font-semibold text-theme-primary mb-3">Kubernetes</h3>
            <p className="text-theme-secondary mb-6">
              Deploy on any cloud provider or K8s cluster. Helm chart included. Scale from 1 to 1,000+ robots.
            </p>
            <ul className="text-left space-y-3 mb-6">
              <li className="flex items-center gap-3 text-theme-secondary">
                <svg className="w-5 h-5 text-turquoise flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span>Helm chart included</span>
              </li>
              <li className="flex items-center gap-3 text-theme-secondary">
                <svg className="w-5 h-5 text-turquoise flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span>Auto-scaling fleet support</span>
              </li>
              <li className="flex items-center gap-3 text-theme-secondary">
                <svg className="w-5 h-5 text-turquoise flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span>Any cloud provider</span>
              </li>
            </ul>
            <a
              href="https://github.com/RaaSaaR-org/robot-management-system/tree/main/helm"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-outline-white inline-flex items-center gap-2"
            >
              Helm Chart Docs
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * @file ScreenshotsSection.tsx
 * @description Landing page section showing one screenshot per lifecycle phase
 * @feature landing
 */

const SCREENSHOTS = [
  {
    src: `${import.meta.env.BASE_URL}screenshots/dashboard.png`,
    alt: 'Fleet Dashboard — Live telemetry across every robot',
    label: 'Operate',
    caption: 'Fleet Dashboard',
    href: `${import.meta.env.BASE_URL}#/dashboard`,
  },
  {
    src: `${import.meta.env.BASE_URL}screenshots/training.png`,
    alt: 'Training Studio — Fine-tune VLA models on your own data',
    label: 'Train',
    caption: 'Training Studio',
    href: `${import.meta.env.BASE_URL}#/training`,
  },
  {
    src: `${import.meta.env.BASE_URL}screenshots/compliance.png`,
    alt: 'Compliance & Audit — EU AI Act ready, with immutable decision logs',
    label: 'Comply',
    caption: 'Compliance & Audit',
    href: `${import.meta.env.BASE_URL}#/compliance`,
  },
];

export function ScreenshotsSection() {
  return (
    <section className="py-20 section-secondary">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <p className="text-turquoise font-mono text-sm mb-4 tracking-wider uppercase">
            One Platform, Every Phase
          </p>
          <h2 className="text-3xl font-bold text-theme-primary mb-3">See It In Action</h2>
          <p className="text-theme-secondary max-w-2xl mx-auto">
            A single workbench for the full Physical AI lifecycle — from training
            runs to compliant production.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {SCREENSHOTS.map((shot) => (
            <a key={shot.caption} href={shot.href} className="group block">
              <div className="overflow-hidden rounded-xl border border-theme shadow-lg transition-transform group-hover:scale-[1.02]">
                <img src={shot.src} alt={shot.alt} className="w-full h-auto" loading="lazy" />
              </div>
              <div className="mt-3 text-center">
                <span className="inline-block px-2 py-0.5 text-xs font-mono rounded-full bg-cobalt/10 text-cobalt border border-cobalt/20 mb-1">
                  {shot.label}
                </span>
                <p className="text-sm font-medium text-theme-secondary group-hover:text-theme-primary transition-colors">
                  {shot.caption}
                </p>
              </div>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

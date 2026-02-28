/**
 * @file ScreenshotsSection.tsx
 * @description Landing page section showing platform screenshots
 * @feature landing
 */

const SCREENSHOTS = [
  {
    src: `${import.meta.env.BASE_URL}screenshots/dashboard.png`,
    alt: 'Fleet Dashboard — Monitor 5 robots in real-time',
    label: 'Fleet Dashboard',
  },
  {
    src: `${import.meta.env.BASE_URL}screenshots/robot-h1-detail.png`,
    alt: 'H1 Robot Detail — Telemetry and joint states',
    label: 'Robot Detail',
  },
  {
    src: `${import.meta.env.BASE_URL}screenshots/fleet-map.png`,
    alt: 'Fleet Map — Spatial robot positioning',
    label: 'Fleet Map',
  },
];

export function ScreenshotsSection() {
  return (
    <section className="py-20 section-secondary">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-theme-primary mb-3">See It In Action</h2>
          <p className="text-theme-secondary max-w-2xl mx-auto">
            A modern fleet management UI built for robotics teams.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {SCREENSHOTS.map((shot) => (
            <a
              key={shot.label}
              href={`${import.meta.env.BASE_URL}#/dashboard`}
              className="group block"
            >
              <div className="overflow-hidden rounded-xl border border-theme shadow-lg transition-transform group-hover:scale-[1.02]">
                <img
                  src={shot.src}
                  alt={shot.alt}
                  className="w-full h-auto"
                  loading="lazy"
                />
              </div>
              <p className="mt-3 text-center text-sm font-medium text-theme-secondary group-hover:text-theme-primary transition-colors">
                {shot.label}
              </p>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

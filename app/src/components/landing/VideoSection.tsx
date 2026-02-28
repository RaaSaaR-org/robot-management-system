/**
 * @file VideoSection.tsx
 * @description Landing page section with platform demo video
 * @feature landing
 */

export function VideoSection() {
  return (
    <section className="py-20 section-primary">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-10">
          <h2 className="text-3xl font-bold text-theme-primary mb-3">Watch the Demo</h2>
          <p className="text-theme-secondary max-w-2xl mx-auto">
            See NeoDEM manage a multi-robot H1 fleet in real-time.
          </p>
        </div>

        <div className="max-w-[900px] mx-auto">
          <div className="overflow-hidden rounded-xl border border-theme shadow-lg">
            <video
              autoPlay
              muted
              loop
              playsInline
              className="w-full h-auto"
            >
              <source
                src={`${import.meta.env.BASE_URL}videos/platform-overview.webm`}
                type="video/webm"
              />
              Your browser does not support the video tag.
            </video>
          </div>
        </div>
      </div>
    </section>
  );
}

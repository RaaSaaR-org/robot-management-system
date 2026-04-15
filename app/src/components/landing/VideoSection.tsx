/**
 * @file VideoSection.tsx
 * @description Landing page section with tabbed platform demo videos
 * @feature landing
 */

import { useState } from 'react';
import { useBrand } from '@/brand';

const VIDEO_TABS = [
  {
    id: 'lifecycle-tour',
    label: 'Full Lifecycle Tour',
    file: 'lifecycle-tour.webm',
    caption: 'Collect → Train → Deploy → Evaluate → Operate → Comply in one sweep.',
  },
  {
    id: 'collect-train',
    label: 'Collect → Train',
    file: 'collect-train.webm',
    caption: 'The dev side: record demonstrations, curate datasets, train VLA models.',
  },
  {
    id: 'operate-comply',
    label: 'Operate → Comply',
    file: 'operate-comply.webm',
    caption: 'The ops side: live dashboard, fleet map, and audit-ready compliance.',
  },
] as const;

export function VideoSection() {
  const brand = useBrand();
  const [activeTab, setActiveTab] = useState<(typeof VIDEO_TABS)[number]['id']>(VIDEO_TABS[0].id);

  const activeVideo = VIDEO_TABS.find((t) => t.id === activeTab) ?? VIDEO_TABS[0];

  return (
    <section className="py-20 section-primary">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-10">
          <p className="text-turquoise font-mono text-sm mb-4 tracking-wider uppercase">
            Watch the Loop
          </p>
          <h2 className="text-3xl font-bold text-theme-primary mb-3">See the Lifecycle in Motion</h2>
          <p className="text-theme-secondary max-w-2xl mx-auto">
            Three short demos of {brand.name} — one for each side of the loop, plus a full
            tour across every phase.
          </p>
        </div>

        {/* Tab buttons */}
        <div className="flex flex-wrap justify-center gap-2 mb-6">
          {VIDEO_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 text-sm font-medium rounded-brand transition-colors ${
                activeTab === tab.id
                  ? 'bg-cobalt text-white'
                  : 'text-theme-secondary hover:text-theme-primary hover:bg-theme-hover'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Video player */}
        <div className="max-w-[900px] mx-auto">
          <div className="overflow-hidden rounded-xl border border-theme shadow-lg">
            <video
              key={activeVideo.id}
              autoPlay
              muted
              loop
              playsInline
              className="w-full h-auto"
            >
              <source
                src={`${import.meta.env.BASE_URL}videos/${activeVideo.file}`}
                type="video/webm"
              />
              Your browser does not support the video tag.
            </video>
          </div>
          <p className="text-center text-theme-muted text-sm mt-4 font-mono">{activeVideo.caption}</p>
        </div>
      </div>
    </section>
  );
}

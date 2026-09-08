/**
 * @file LandingPage.tsx
 * @description Physical AI landing page: vision, lifecycle, evidence and ownership.
 * @feature landing
 */

import { scrollToSection } from '../components/landing/scrollToSection';
import { Header } from '../components/landing/Header';
import { HeroSection } from '../components/landing/HeroSection';
import { FullCircleSection } from '../components/landing/FullCircleSection';
import { DataEngineSection } from '../components/landing/DataEngineSection';
import { ModelLayerSection } from '../components/landing/ModelLayerSection';
import { HonestySection } from '../components/landing/HonestySection';
import { SovereigntySection } from '../components/landing/SovereigntySection';
import { RunItSection } from '../components/landing/RunItSection';
import { CommunitySection } from '../components/landing/CommunitySection';
import { BeliefReadout } from '../components/landing/BeliefReadout';
import { Footer } from '../components/landing/Footer';

export function LandingPage() {
  return (
    <div className="min-h-screen section-primary">
      <Header />
      <main>
        <HeroSection />
        <FullCircleSection />
        <DataEngineSection />
        <ModelLayerSection />
        <section className="lp-section" aria-labelledby="landing-proof-heading">
          <div className="lp-container grid items-center gap-10 lg:grid-cols-2 lg:gap-20">
            <div>
              <p className="lp-key">FROM THE SIMULATOR / A LOGGED RUN</p>
              <h2 id="landing-proof-heading" className="lp-display lp-h2 mt-6">
                Intelligence is knowing
                <br />
                when to stop.
              </h2>
              <p className="lp-lede mt-6">
                A command to walk two metres. A rack in the way. Watch the safety layer stop the
                robot — and refuse the next command.
              </p>
              <p className="lp-body mt-5">
                This replay comes from a logged warehouse simulation on 2 August 2026, using the
                same controls as a real G1. The robot stopped 0.48 m from the rack; a second
                approach stopped at 0.49 m. These are simulation results, not physical hardware
                measurements.
              </p>
              <a
                href="#safety"
                onClick={(event) => scrollToSection(event, '#safety')}
                className="lp-btn-secondary mt-7 inline-flex px-5 py-3 text-sm"
              >
                Explore the safety layers ↓
              </a>
            </div>
            <BeliefReadout />
          </div>
        </section>
        <HonestySection />
        <SovereigntySection />
        <RunItSection />
        <CommunitySection />
      </main>
      <Footer />
    </div>
  );
}

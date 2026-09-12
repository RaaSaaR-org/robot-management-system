/**
 * @file LandingPage.tsx
 * @description Physical AI landing page: vision, lifecycle, evidence and ownership.
 * @feature landing
 */

import { Link } from 'react-router-dom';
import { Header } from '../components/landing/Header';
import { HeroSection } from '../components/landing/HeroSection';
import { PlatformSection } from '../components/landing/PlatformSection';
import { FullCircleSection } from '../components/landing/FullCircleSection';
import { DataEngineSection } from '../components/landing/DataEngineSection';
import { ModelLayerSection } from '../components/landing/ModelLayerSection';
import { SovereigntySection } from '../components/landing/SovereigntySection';
import { RunItSection } from '../components/landing/RunItSection';
import { CommunitySection } from '../components/landing/CommunitySection';
import { SafetyRobotScene } from '../components/landing/SafetyRobotScene';
import { BeliefReadout } from '../components/landing/BeliefReadout';
import { Footer } from '../components/landing/Footer';
import '../components/landing/landing-theme.css';

export function LandingPage() {
  return (
    <div className="landing-page min-h-screen">
      <Header />
      <main>
        <HeroSection />
        <PlatformSection />
        <FullCircleSection />
        <DataEngineSection />
        <ModelLayerSection />
        {/* The page's one piece of evidence, and the only section whose anchor
            is reached from the loop above — hence its own id. */}
        <section id="proof" className="lp-section lp-anchor" aria-labelledby="landing-proof-heading">
          <div className="lp-container">
            <div>
              <p className="lp-key">FROM THE SIMULATOR / A LOGGED RUN</p>
              <h2 id="landing-proof-heading" className="lp-display lp-h2 mt-6">
                Intelligence is knowing
                <br />
                when to stop.
              </h2>
              <p className="lp-lede mt-6 max-w-2xl">
                A command to walk two metres. A rack in the way. Watch the safety layer stop the
                robot — and refuse the next command.
              </p>
              {/* Where the run came from, and every other safety layer, is one
                  link away in the doc — the exhibit's own labels carry what a
                  reader needs to trust the number in front of them. */}
              <Link
                to="/docs/platform#safety"
                className="lp-btn-secondary mt-7 inline-flex px-5 py-3 text-sm"
              >
                Read how the safety layer works →
              </Link>
            </div>
            <div className="safety-exhibit">
              <div className="safety-illustration">
                <span className="safety-illustration-label">HUMANOID CONCEPT / HOLD POSITION</span>
                <SafetyRobotScene />
                <div className="safety-stop-distance">
                  <span>
                    LOGGED SIMULATION
                    <br />
                    CLEARANCE FROM RACK
                  </span>
                  <strong>0.48 m</strong>
                </div>
              </div>
              <div className="safety-evidence">
                <BeliefReadout />
                <p>
                  The illustration shows a stationary humanoid concept. The readout replays the
                  recorded G1 simulation; it is not live robot telemetry.
                </p>
              </div>
            </div>
          </div>
        </section>
        <SovereigntySection />
        <RunItSection />
        <CommunitySection />
      </main>
      <Footer />
    </div>
  );
}

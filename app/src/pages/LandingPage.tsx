/**
 * @file LandingPage.tsx
 * @description Marketing landing page — an instrument panel, read top to bottom.
 * @feature landing
 *
 * Order is the argument: claim → proof → mechanism → the differentiator →
 * sovereignty → how to run it → who builds it.
 *
 * There is no closing CTA band. It was a full-bleed brand-colour slab whose
 * every line already appeared earlier on the page, it failed contrast against a
 * white-labelled primary, and it out-shouted the hero instrument the page is
 * actually built around. The page closes on the roles ledger instead.
 *
 * The old page ran 15 sections and stated the six-stage lifecycle five times.
 * Stats, Audience, Advantages, Features and the data-flywheel diagram were cut;
 * their true claims live in the lifecycle and honesty sections now.
 */

import { Header } from '../components/landing/Header';
import { HeroSection } from '../components/landing/HeroSection';
import { ProofSection } from '../components/landing/ProofSection';
import { LifecycleLoopSection } from '../components/landing/LifecycleLoopSection';
import { HonestySection } from '../components/landing/HonestySection';
import { SovereigntySection } from '../components/landing/SovereigntySection';
import { RunItSection } from '../components/landing/RunItSection';
import { CommunitySection } from '../components/landing/CommunitySection';
import { Footer } from '../components/landing/Footer';

export function LandingPage() {
  return (
    <div className="min-h-screen section-primary">
      <Header />
      <main>
        <HeroSection />
        <ProofSection />
        <LifecycleLoopSection />
        <HonestySection />
        <SovereigntySection />
        <RunItSection />
        <CommunitySection />
      </main>
      <Footer />
    </div>
  );
}

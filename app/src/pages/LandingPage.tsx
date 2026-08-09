/**
 * @file LandingPage.tsx
 * @description Marketing landing page — an instrument panel, read top to bottom.
 * @feature landing
 *
 * Order is the argument: claim → the loop the whole platform is built around →
 * what feeds it → what runs on it → the differentiator → sovereignty → how to
 * run it → who builds it.
 *
 * There is no screenshot section. It was one still of the fleet dashboard under
 * the heading "This is the actual product" — a claim the live demo in the hero
 * makes better, since a visitor can click into the running app instead of
 * looking at a picture of it. A static image also dates the moment the UI moves,
 * which is how the previous capture ended up showing a design that no longer
 * existed.
 *
 * The full circle sits second, immediately under the hero, because it is the
 * product: six stages with nothing to export between them. It is also the one
 * section that drops the legend rail and takes its own ground colour, so the
 * page has exactly one centrepiece rather than eight equal blocks.
 *
 * Data and Models follow it in that order deliberately — the loop's first two
 * stages, expanded. Collecting is a first-class pillar rather than a preamble,
 * and the model layer is where the no-vendor-login claim gets itemised instead
 * of asserted.
 *
 * There is no closing CTA band. It was a full-bleed brand-colour slab whose
 * every line already appeared earlier on the page, it failed contrast against a
 * white-labelled primary, and it out-shouted the hero instrument the page is
 * actually built around. The page closes on the roles ledger instead.
 */

import { Header } from '../components/landing/Header';
import { HeroSection } from '../components/landing/HeroSection';
import { FullCircleSection } from '../components/landing/FullCircleSection';
import { DataEngineSection } from '../components/landing/DataEngineSection';
import { ModelLayerSection } from '../components/landing/ModelLayerSection';
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
        <FullCircleSection />
        <DataEngineSection />
        <ModelLayerSection />
        <HonestySection />
        <SovereigntySection />
        <RunItSection />
        <CommunitySection />
      </main>
      <Footer />
    </div>
  );
}

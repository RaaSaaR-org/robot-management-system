import { Header } from '../components/landing/Header';
import { HeroSection } from '../components/landing/HeroSection';
import { ScreenshotsSection } from '../components/landing/ScreenshotsSection';
import { StatsSection } from '../components/landing/StatsSection';
import { FeatureSection } from '../components/landing/FeatureSection';
import { VideoSection } from '../components/landing/VideoSection';
import { AdvantagesSection } from '../components/landing/AdvantagesSection';
import { DataEcosystemSection } from '../components/landing/DataEcosystemSection';
import { SafetyPreview } from '../components/landing/SafetyPreview';
import { AudienceSection } from '../components/landing/AudienceSection';
import { DeploymentSection } from '../components/landing/DeploymentSection';
import { CTASection } from '../components/landing/CTASection';
import { Footer } from '../components/landing/Footer';

export function LandingPage() {
  return (
    <div className="min-h-screen section-primary">
      <Header />
      <main>
        <HeroSection />
        <ScreenshotsSection />
        <StatsSection />
        <FeatureSection />
        <VideoSection />
        <AdvantagesSection />
        <DataEcosystemSection />
        <SafetyPreview />
        <AudienceSection />
        <DeploymentSection />
        <CTASection />
      </main>
      <Footer />
    </div>
  );
}

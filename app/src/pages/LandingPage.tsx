import { Header } from '../components/landing/Header';
import { HeroSection } from '../components/landing/HeroSection';
import { FeatureSection } from '../components/landing/FeatureSection';
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
        <FeatureSection />
        <SafetyPreview />
        <AudienceSection />
        <DeploymentSection />
        <CTASection />
      </main>
      <Footer />
    </div>
  );
}

/**
 * @file HeroSection.tsx
 * @description Physical AI positioning across humanoid, aerial and quadruped embodiments.
 * @feature landing
 */
import { memo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUpRight } from 'lucide-react';
import { useBrand } from '@/brand';
import { HeroScene } from './HeroScene';
import { scrollToSection } from './scrollToSection';
import './hero.css';

export const HeroSection = memo(function HeroSection() {
  const brand = useBrand();
  return (
    <section className="field-hero" aria-labelledby="hero-heading">
      <div className="lp-container field-content">
        <div className="field-layout">
          <div className="field-copy">
            <p className="field-kicker">
              <span /> {brand.name} / THE OPEN PHYSICAL AI PLATFORM
            </p>
            <h1 id="hero-heading">
              Intelligence.
              <br />
              <span>Made physical.</span>
            </h1>
            <p className="field-lede">
              A world beyond the screen.
              <br />
              Connect your data, models and machines in one open platform. From
              humanoids to quadrupeds to the skies.
            </p>
            <div className="field-actions">
              <Link to="/dashboard" className="field-primary">
                Explore the platform{' '}
                <ArrowUpRight size={18} aria-hidden="true" />
              </Link>
              <a
                href="#circle"
                onClick={(event) => scrollToSection(event, '#circle')}
              >
                Discover the Embodied Loop{' '}
                <ArrowDown size={15} aria-hidden="true" />
              </a>
            </div>
            <div className="field-principles">
              <span>Open source</span>
              <i />
              <span>Any model</span>
              <i />
              <span>Your control</span>
            </div>
          </div>
          <HeroScene />
        </div>
        <div className="field-footnote">
          <span>ONE PLATFORM. EVERY EMBODIMENT.</span>
          <span>
            Hardware-agnostic architecture. Integration readiness varies by
            robot.
          </span>
        </div>
      </div>
    </section>
  );
});

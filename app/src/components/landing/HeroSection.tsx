/**
 * @file HeroSection.tsx
 * @description Physical AI positioning over a cinematic three-dimensional intelligence engine.
 * @feature landing
 */
import { memo } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUpRight } from "lucide-react";
import { useBrand } from "@/brand";
import { HeroScene } from "./HeroScene";
import { scrollToSection } from "./scrollToSection";
import "./hero.css";

export const HeroSection = memo(function HeroSection() {
  const brand = useBrand();
  return (
    <section className="field-hero" aria-labelledby="hero-heading">
      <HeroScene />
      <div className="lp-container field-content">
        <div className="field-layout">
          <div className="field-copy">
            <p className="field-kicker">
              <span /> {brand.name} / THE OPEN PHYSICAL AI PLATFORM
            </p>
            <h1 id="hero-heading">
              The Physical
              <br />
              AI Platform.
            </h1>
            <p className="field-lede">
              Intelligence belongs in the real world.
              <br />
              Bring your data, models and machines together — from the first
              experiment to your entire fleet.
            </p>
            <div className="field-actions">
              <Link to="/dashboard" className="field-primary">
                Explore the platform <ArrowUpRight size={18} />
              </Link>
              <a
                href="#circle"
                onClick={(event) => scrollToSection(event, "#circle")}
              >
                Discover the Embodied Loop <ArrowDown size={16} />
              </a>
            </div>
          </div>
        </div>
        <div className="field-footnote">
          <span>OPEN SOURCE. YOUR MODELS. YOUR HARDWARE. YOUR CONTROL.</span>
          <span>
            Hardware-agnostic architecture. Integration readiness varies by
            robot.
          </span>
        </div>
      </div>
    </section>
  );
});

/**
 * @file HeroScene.tsx
 * @description Automatic embodiment transformations with a static, motion-safe fallback.
 * @feature landing
 */
import { memo, useEffect, useRef, useState } from 'react';
import { HERO_EMBODIMENTS, type HeroEngine } from './heroEmbodiments';

export const HeroScene = memo(function HeroScene() {
  const host = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [embodiment, setEmbodiment] = useState(0);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let engine: HeroEngine | null = null;
    let generation = 0;

    function start() {
      const current = ++generation;
      engine?.dispose();
      engine = null;
      setReady(false);
      // The static composition shows all three embodiments and costs no GPU
      // work. Honor preference changes as well as the initial OS setting.
      if (motion.matches) return;
      void import('./heroEngine')
        .then(({ createHeroEngine }) => {
          if (current !== generation) return;
          engine = createHeroEngine(
            element!,
            () => {
              if (current === generation) setReady(true);
            },
            () => {
              if (current === generation) setReady(false);
            },
            (index) => {
              if (current === generation) setEmbodiment(index);
            },
          );
        })
        .catch(() => {
          /* Keep the poster if WebGL is unavailable. */
        });
    }
    start();
    motion.addEventListener('change', start);
    return () => {
      generation++;
      motion.removeEventListener('change', start);
      engine?.dispose();
    };
  }, []);

  return (
    <div
      className={`hero-universe${ready ? ' is-ready' : ''}`}
      data-embodiment={ready ? HERO_EMBODIMENTS[embodiment].id : 'all'}
    >
      <div className="hero-artwork" aria-hidden="true">
        <div className="hero-universe-fallback">
          <img
            src={`${import.meta.env.BASE_URL}assets/landing/hero-embodiments.webp`}
            alt=""
            width={1000}
            height={730}
            decoding="async"
          />
        </div>
        <div className="hero-universe-canvas" ref={host} />
        <div className="hero-universe-shade" />
      </div>
      <div className="hero-scene-heading" aria-hidden="true">
        <span className="hero-scene-cross">+</span>
        <span>ONE INTELLIGENCE. MANY FORMS.</span>
        <span className="hero-scene-edition">NEODEM / 01</span>
      </div>
      <div className="hero-callout hero-callout-world" aria-hidden="true">
        <span>SHARED INTELLIGENCE</span>
        <strong>Your models. Every form.</strong>
        <i />
      </div>
      <div className="hero-callout hero-callout-model" aria-hidden="true">
        <span>PHYSICAL WORLD</span>
        <strong>Ground. Air. Everywhere.</strong>
        <i />
      </div>
      <div className="hero-scene-caption" aria-hidden="true">
        <span>
          <i />{' '}
          {ready
            ? HERO_EMBODIMENTS[embodiment].label
            : 'HUMANOID / AERIAL / QUADRUPED'}
        </span>
        <span className="hero-scene-state">EMBODIMENT-AGNOSTIC</span>
      </div>
      <p className="sr-only">
        Humanoid, drone and quadruped digital twins illustrate one Physical AI
        platform across different embodiments.
      </p>
    </div>
  );
});

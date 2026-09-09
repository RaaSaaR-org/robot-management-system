/**
 * @file HeroScene.tsx
 * @description Lazy Three.js intelligence engine with a static brand fallback and bounded GPU lifecycle.
 * @feature landing
 */
import { memo, useEffect, useRef, useState } from "react";
import { NeoDEMMark } from "@/components/common/NeoDEMMark";

export const HeroScene = memo(function HeroScene() {
  const host = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let disposed = false;
    let cleanup = () => {};
    // Load the renderer separately so the heading and navigation never wait for 3D.
    void import("./heroEngine")
      .then(({ createHeroEngine }) => {
        if (disposed) return;
        cleanup = createHeroEngine(
          element,
          () => setReady(true),
          () => setReady(false),
        );
      })
      .catch(() => {
        /* The static brand artwork remains visible. */
      });
    return () => {
      disposed = true;
      cleanup();
    };
  }, []);

  return (
    <div
      className={`hero-universe${ready ? " is-ready" : ""}`}
      aria-hidden="true"
    >
      <div className="hero-universe-fallback">
        <NeoDEMMark width={300} height={300} />
      </div>
      <div className="hero-universe-canvas" ref={host} />
      <div className="hero-universe-shade" />
    </div>
  );
});

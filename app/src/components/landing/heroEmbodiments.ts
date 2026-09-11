/**
 * @file heroEmbodiments.ts
 * @description Digital twins and the continuous hardware-to-pixel transformation timeline.
 * @feature landing
 */
export const HERO_EMBODIMENTS = [
  { id: 'humanoid', label: 'G1 / HUMANOID', asset: 'g1-twin.glb' },
  { id: 'drone', label: 'X500 / AERIAL', asset: 'x500-twin.glb' },
  { id: 'quadruped', label: 'GO2 / QUADRUPED', asset: 'go2-twin.glb' },
] as const;

export const HERO_CYCLE_SECONDS = 8;

const ramp = (value: number, start: number, end: number) =>
  Math.max(0, Math.min(1, (value - start) / (end - start)));

/** Hold the hardware, dissolve, transport the same pixels, then resolve. */
export function getHeroSequence(elapsed: number, count: number) {
  const cycle = Math.floor(elapsed / HERO_CYCLE_SECONDS);
  const time = elapsed % HERO_CYCLE_SECONDS;
  return {
    from: cycle % count,
    to: (cycle + 1) % count,
    dissolve: ramp(time, 3.4, 4.65),
    morph: ramp(time, 4.65, 6.65),
    resolve: ramp(time, 6.65, HERO_CYCLE_SECONDS),
  };
}

export interface HeroEngine {
  dispose: () => void;
}

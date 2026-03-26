/**
 * @file useCountUp.ts
 * @description Animated counter hook with ease-out cubic easing
 * @feature shared
 */

import { useState, useEffect, useRef } from 'react';

/**
 * Animates a number from its previous value to the target value with ease-out cubic easing.
 * Correctly handles React StrictMode double-invoke and target changes.
 *
 * @param target - The target number to count up to
 * @param duration - Animation duration in milliseconds (default 1000)
 * @param delay - Delay before animation starts in milliseconds (default 0)
 * @returns The current animated value
 */
export function useCountUp(target: number, duration = 1000, delay = 0): number {
  const [count, setCount] = useState(0);
  const prevTargetRef = useRef(0);
  const rafRef = useRef(0);

  useEffect(() => {
    if (target === prevTargetRef.current) return;

    const from = prevTargetRef.current;

    const timeout = setTimeout(() => {
      prevTargetRef.current = target;
      const startTime = performance.now();
      const step = () => {
        const elapsed = performance.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        // Ease-out cubic
        const eased = 1 - Math.pow(1 - progress, 3);
        setCount(Math.round(from + eased * (target - from)));
        if (progress < 1) {
          rafRef.current = requestAnimationFrame(step);
        }
      };
      rafRef.current = requestAnimationFrame(step);
    }, delay);

    return () => {
      clearTimeout(timeout);
      cancelAnimationFrame(rafRef.current);
      setCount(target);
    };
  }, [target, duration, delay]);

  return count;
}

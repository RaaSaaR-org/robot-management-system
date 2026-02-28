/**
 * @file useCountUp.ts
 * @description Animated counter hook with ease-out cubic easing
 * @feature shared
 */

import { useState, useEffect, useRef } from 'react';

/**
 * Animates a number from 0 to the target value with ease-out cubic easing.
 *
 * @param target - The target number to count up to
 * @param duration - Animation duration in milliseconds (default 1000)
 * @param delay - Delay before animation starts in milliseconds (default 0)
 * @returns The current animated value
 */
export function useCountUp(target: number, duration = 1000, delay = 0): number {
  const [count, setCount] = useState(0);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    if (target === 0) return;
    startedRef.current = true;

    const timeout = setTimeout(() => {
      const startTime = performance.now();
      const step = () => {
        const elapsed = performance.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        // Ease-out cubic
        const eased = 1 - Math.pow(1 - progress, 3);
        setCount(Math.round(eased * target));
        if (progress < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }, delay);

    return () => clearTimeout(timeout);
  }, [target, duration, delay]);

  return count;
}

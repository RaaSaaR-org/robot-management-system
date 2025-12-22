/**
 * @file useMediaQuery.ts
 * @description Hooks for responsive breakpoint detection
 * @feature shared
 * @dependencies None
 */

import { useState, useEffect } from 'react';

// ============================================================================
// BREAKPOINTS (matching Tailwind defaults)
// ============================================================================

export const BREAKPOINTS = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
} as const;

// ============================================================================
// MAIN HOOK
// ============================================================================

/**
 * Tracks whether a CSS media query matches.
 *
 * @param query - CSS media query string (e.g., "(min-width: 768px)")
 * @returns Whether the media query currently matches
 *
 * @example
 * ```typescript
 * const isLargeScreen = useMediaQuery('(min-width: 1024px)');
 * ```
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const mediaQuery = window.matchMedia(query);

    // Set initial value
    setMatches(mediaQuery.matches);

    // Create listener
    const handleChange = (event: MediaQueryListEvent) => {
      setMatches(event.matches);
    };

    // Add listener (use addEventListener for modern browsers)
    mediaQuery.addEventListener('change', handleChange);

    return () => {
      mediaQuery.removeEventListener('change', handleChange);
    };
  }, [query]);

  return matches;
}

// ============================================================================
// CONVENIENCE HOOKS
// ============================================================================

/**
 * Returns true when screen width is below md breakpoint (768px).
 * Useful for showing mobile-specific UI.
 *
 * @example
 * ```typescript
 * const isMobile = useIsMobile();
 * return isMobile ? <MobileNav /> : <Sidebar />;
 * ```
 */
export function useIsMobile(): boolean {
  return useMediaQuery(`(max-width: ${BREAKPOINTS.md - 1}px)`);
}

/**
 * Returns true when screen width is at or above md breakpoint (768px).
 * Useful for showing tablet/desktop-specific UI.
 *
 * @example
 * ```typescript
 * const isTabletOrAbove = useIsTabletOrAbove();
 * ```
 */
export function useIsTabletOrAbove(): boolean {
  return useMediaQuery(`(min-width: ${BREAKPOINTS.md}px)`);
}

/**
 * Returns true when screen width is at or above lg breakpoint (1024px).
 * Useful for showing desktop-specific UI.
 *
 * @example
 * ```typescript
 * const isDesktop = useIsDesktop();
 * return isDesktop && <DesktopSidebar />;
 * ```
 */
export function useIsDesktop(): boolean {
  return useMediaQuery(`(min-width: ${BREAKPOINTS.lg}px)`);
}

/**
 * Returns the current breakpoint name based on screen width.
 *
 * @example
 * ```typescript
 * const breakpoint = useBreakpoint();
 * // Returns: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl'
 * ```
 */
export function useBreakpoint(): 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' {
  const is2xl = useMediaQuery(`(min-width: ${BREAKPOINTS['2xl']}px)`);
  const isXl = useMediaQuery(`(min-width: ${BREAKPOINTS.xl}px)`);
  const isLg = useMediaQuery(`(min-width: ${BREAKPOINTS.lg}px)`);
  const isMd = useMediaQuery(`(min-width: ${BREAKPOINTS.md}px)`);
  const isSm = useMediaQuery(`(min-width: ${BREAKPOINTS.sm}px)`);

  if (is2xl) return '2xl';
  if (isXl) return 'xl';
  if (isLg) return 'lg';
  if (isMd) return 'md';
  if (isSm) return 'sm';
  return 'xs';
}

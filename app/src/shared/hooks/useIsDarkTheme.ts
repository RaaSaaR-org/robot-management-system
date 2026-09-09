/**
 * @file useIsDarkTheme.ts
 * @description Tracks the resolved (light/dark) theme actually on the document
 * @feature shared
 * @dependencies None
 */

import { useEffect, useState } from 'react';

/**
 * Reports whether the app is currently rendering dark.
 *
 * Reads the class ThemeProvider writes onto <html> rather than the theme store,
 * so `system` resolves to a concrete answer and follows OS changes without the
 * caller duplicating that logic. Anything that needs a *colour value* should use
 * a CSS variable instead — this is for the handful of places that must hand a
 * palette to a JS library (the docs syntax highlighter, chart themes).
 *
 * @example
 * ```typescript
 * const isDark = useIsDarkTheme();
 * <SyntaxHighlighter style={isDark ? oneDark : oneLight} />
 * ```
 */
export function useIsDarkTheme(): boolean {
  const [isDark, setIsDark] = useState(readIsDark);

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const observer = new MutationObserver(() => setIsDark(readIsDark()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    setIsDark(readIsDark());

    return () => observer.disconnect();
  }, []);

  return isDark;
}

/** Dark is the default surface: `:root` is dark unless `.light` is set. */
function readIsDark(): boolean {
  if (typeof document === 'undefined') return true;
  return !document.documentElement.classList.contains('light');
}

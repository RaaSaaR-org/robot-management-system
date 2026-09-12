/**
 * @file usePaletteHotkey.ts
 * @description The app's one global keyboard binding: ⌘K / Ctrl+K toggles the
 *              command palette — plus the label the top bar prints for it.
 *              A modifier on purpose, and no bare-letter binding anywhere: the
 *              teleop cockpit drives a robot with plain WASD, and the palette
 *              must never reach into a page that is listening for letters.
 * @feature layout
 */

import { useEffect, useRef } from 'react';

// ============================================================================
// PLATFORM
// ============================================================================

/** Apple keyboards, where the modifier is Command and prints as ⌘. */
function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  // `platform` is deprecated but still the most accurate signal where it
  // exists; the user-agent string covers the browsers that have dropped it.
  const source = `${navigator.platform ?? ''} ${navigator.userAgent ?? ''}`;
  return /Mac|iPhone|iPad|iPod/.test(source);
}

/** How the shortcut is written for the user: `⌘K` on Apple, `Ctrl K` elsewhere. */
export function paletteShortcutLabel(): string {
  return isApplePlatform() ? '⌘K' : 'Ctrl K';
}

// ============================================================================
// HOOK
// ============================================================================

/**
 * Binds ⌘K / Ctrl+K on `document` for as long as the caller is mounted. Mount
 * it once — the shell does, next to the palette itself.
 *
 * @example
 * ```tsx
 * const [open, setOpen] = useState(false);
 * usePaletteHotkey(() => setOpen((current) => !current));
 * ```
 */
export function usePaletteHotkey(onToggle: () => void): void {
  // The latest callback without re-binding the listener on every render.
  const onToggleRef = useRef(onToggle);
  useEffect(() => {
    onToggleRef.current = onToggle;
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Held down, the key would toggle the palette open and shut.
      if (event.repeat) return;
      if (!event.metaKey && !event.ctrlKey) return;
      if (event.key.toLowerCase() !== 'k') return;
      // Ctrl+K is the browser's search bar on some platforms, ⌘K a link dialog
      // in text fields — inside the app the palette wins.
      event.preventDefault();
      onToggleRef.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);
}

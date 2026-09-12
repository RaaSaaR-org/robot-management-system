/**
 * @file index.ts
 * @description Barrel export for the command palette
 * @feature layout
 */

export { CommandPalette, matchDestinations, paletteDestinations } from './CommandPalette';
export type { CommandPaletteProps } from './CommandPalette';
export { usePaletteHotkey, paletteShortcutLabel } from './usePaletteHotkey';

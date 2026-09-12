/**
 * @file styles.ts
 * @description Class strings shared by several kit primitives: the focus ring,
 *              the field look (inputs, selects, textareas), labels and the tone
 *              palette that StatusTag, Badge, StatTile, ProgressBar and toasts
 *              all draw from. One place, so a tone or a field looks identical
 *              everywhere it appears.
 * @feature shared
 */

// ============================================================================
// FOCUS
// ============================================================================

/**
 * Focus-visible ring: 2px primary, offset so it reads on whatever ground the
 * control sits on. An outline (not a box-shadow ring) so the offset shows the
 * real background — canvas, panel or modal — instead of a painted colour.
 */
export const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/** Same ring drawn inside the element — for table rows and flush list items. */
export const focusRingInset =
  'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary';

// ============================================================================
// TYPE
// ============================================================================

/** 11px uppercase tracked label — eyebrows, table heads, stat labels. */
export const labelCaps = 'text-[11px] font-medium uppercase tracking-[0.12em] text-ink-tertiary';

/** Panel / modal title: Archivo 16px 600. */
export const panelTitle = 'font-display text-base font-semibold tracking-[-0.01em] text-ink-primary';

// ============================================================================
// FIELDS
// ============================================================================

export type FieldSize = 'sm' | 'md' | 'lg';

/** Shared look of every text-like control (Input, Select, Textarea, SearchInput). */
export const fieldBase =
  'w-full rounded-control border bg-field text-ink-primary placeholder:text-ink-muted ' +
  'transition-colors duration-150 ease-[var(--ease-instrument)] ' +
  'focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-50';

export const fieldValid = 'border-line hover:border-line-strong focus:border-primary focus:ring-primary/25';

export const fieldInvalid =
  'border-signal-stopped hover:border-signal-stopped focus:border-signal-stopped focus:ring-signal-stopped/25';

export const fieldSizes: Record<FieldSize, string> = {
  sm: 'h-8 px-2.5 text-[13px]',
  md: 'h-[38px] px-3 text-sm',
  lg: 'h-11 px-3.5 text-[15px]',
};

/** Label above a field: 13px 500 ink-secondary. */
export const fieldLabel = 'text-[13px] font-medium text-ink-secondary';

/** Hint under a field: 12px ink-tertiary. */
export const fieldHint = 'text-xs text-ink-tertiary';

/** Error under a field: 12px signal-stopped. */
export const fieldError = 'text-xs text-signal-stopped';

// ============================================================================
// TONES
// ============================================================================

/** The kit's status tones. `live`/`sim`/`gated`/`stopped` are the landing's signal names. */
export type Tone =
  | 'success'
  | 'info'
  | 'warning'
  | 'danger'
  | 'neutral'
  | 'accent'
  | 'live'
  | 'sim'
  | 'gated'
  | 'stopped';

/** Signal aliases collapse onto the four semantic tones. */
export type BaseTone = 'success' | 'info' | 'warning' | 'danger' | 'neutral' | 'accent';

const TONE_ALIAS: Record<Tone, BaseTone> = {
  success: 'success',
  info: 'info',
  warning: 'warning',
  danger: 'danger',
  neutral: 'neutral',
  accent: 'accent',
  live: 'success',
  sim: 'info',
  gated: 'warning',
  stopped: 'danger',
};

export function baseTone(tone: Tone): BaseTone {
  return TONE_ALIAS[tone] ?? 'neutral';
}

/** Tag look: signal text + 10% fill + 30% border. */
export const toneTag: Record<BaseTone, string> = {
  success: 'text-signal-measured bg-signal-measured/10 border-signal-measured/30',
  info: 'text-signal-estimated bg-signal-estimated/10 border-signal-estimated/30',
  warning: 'text-signal-unknown bg-signal-unknown/10 border-signal-unknown/30',
  danger: 'text-signal-stopped bg-signal-stopped/10 border-signal-stopped/30',
  neutral: 'text-ink-secondary bg-ink-secondary/[0.06] border-line',
  accent: 'text-accent bg-accent/10 border-accent/30',
};

/** Text colour alone. */
export const toneText: Record<BaseTone, string> = {
  success: 'text-signal-measured',
  info: 'text-signal-estimated',
  warning: 'text-signal-unknown',
  danger: 'text-signal-stopped',
  neutral: 'text-ink-secondary',
  accent: 'text-accent',
};

/** Solid fill — dots, progress fills, indicator bars. */
export const toneFill: Record<BaseTone, string> = {
  success: 'bg-signal-measured',
  info: 'bg-signal-estimated',
  warning: 'bg-signal-unknown',
  danger: 'bg-signal-stopped',
  neutral: 'bg-ink-muted',
  accent: 'bg-accent',
};

/**
 * @file hotkeys.ts
 * @description Shared guard for the session page's single-key shortcuts: a
 *              key pressed while typing is text, not a command.
 * @feature datacollection
 */

/** True when the key event is someone typing, not a command. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const t = target as HTMLElement | null;
  if (!t || typeof t.tagName !== 'string') return false;
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable;
}

/**
 * True when a dialog is open and should own the keyboard. The shell keeps its
 * mobile navigation drawer in the DOM as a closed `role="dialog"` with
 * `aria-hidden` + `inert`, so a bare `[role="dialog"]` query is always true —
 * which silently disabled every session hotkey on a real page.
 */
export function isDialogOpen(root: ParentNode = document): boolean {
  return [...root.querySelectorAll('[role="dialog"],[role="alertdialog"]')].some(
    (el) => !el.closest('[aria-hidden="true"],[inert]'),
  );
}

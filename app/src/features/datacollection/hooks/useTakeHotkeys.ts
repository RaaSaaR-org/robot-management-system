/**
 * @file useTakeHotkeys.ts
 * @description The take hotkeys and the Backspace discard's Undo window
 *              (TASK-410), moved unchanged out of the old EpisodePanel
 *              (TASK-428) so the Record console's take dock and its takes list
 *              share them. Space starts or stops a take, N moves to the next
 *              one, Backspace discards the last one after a 5 s window with
 *              Undo (nothing is sent until it closes). Ignored while typing and
 *              while a dialog is open. Leaving the page cancels a discard that
 *              was not sent yet.
 * @feature datacollection
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { dismissToast, toast } from '@/shared/components/ui';
import type { LiveState, TakeAction } from '../types/datacollection.types';
import { takeLabel } from '../utils/takeFormat';
import { isDialogOpen, isTypingTarget } from '../utils/hotkeys';

/** How long a Backspace discard waits for Undo before it is sent. */
export const DISCARD_UNDO_MS = 5000;

export interface UseTakeHotkeysOptions {
  /** The session's live state; `phase: null` means the recorder has no explicit takes */
  live: LiveState | null;
  /** True while the session is recording (takes can start and stop) */
  isRecording: boolean;
  /** The take action in flight, if any */
  pending?: TakeAction | null;
  /** Space / N / Backspace are bound only when true */
  hotkeys?: boolean;
  onStartTake: () => unknown | Promise<unknown>;
  onStopTake: () => unknown | Promise<unknown>;
  onNextTake: () => unknown | Promise<unknown>;
  /**
   * Called after the Undo window when the take named in the toast is STILL the
   * one being recorded: it is ended and discarded, guarded by that take.
   */
  onDiscardLast: (expectedTake: number) => unknown | Promise<unknown>;
  /**
   * Discard one finished take by its number. The Undo window ends here when
   * the named take is no longer recording (TASK-416 D3): a take started
   * elsewhere in the meantime cannot cancel the discard.
   */
  onDiscardTake: (take: number) => unknown | Promise<unknown>;
}

export interface TakeControls {
  /** The recorder takes explicit start/stop. */
  takeMode: boolean;
  capturing: boolean;
  /** The live take, else the last one; null before the first. */
  lastTake: number | null;
  /** Start / Stop / Next are allowed now. */
  canTake: boolean;
  /** Discard (Backspace) is allowed now. */
  canDiscardLast: boolean;
  /** The take a pending Backspace discard names, while its Undo window is open. */
  undoTake: number | null;
  /** Open the 5 s Undo window for the last take. */
  requestDiscardLast: () => void;
  /** Undo: close the window, send nothing. */
  cancelUndo: () => void;
}

export function useTakeHotkeys({
  live, isRecording, pending = null, hotkeys = true,
  onStartTake, onStopTake, onNextTake, onDiscardLast, onDiscardTake,
}: UseTakeHotkeysOptions): TakeControls {
  const [undoTake, setUndoTake] = useState<number | null>(null);
  const undoRef = useRef<{ timer: ReturnType<typeof setTimeout>; toastId: string; take: number } | null>(null);

  const takeMode = !!live && live.phase !== null;
  const capturing = takeMode && live!.phase === 'capturing';
  const lastTake = live?.take ?? null;
  const canTake = isRecording && takeMode && !pending;
  const canDiscardLast = isRecording && takeMode && lastTake !== null && !(live!.lastTake?.discarded && !capturing && live!.lastTake.take === lastTake);
  /** The freshest live state, read when the Undo window closes. */
  const liveRef = useRef(live);
  liveRef.current = live;

  const cancelUndo = useCallback(() => {
    const pendingDiscard = undoRef.current;
    if (!pendingDiscard) return;
    clearTimeout(pendingDiscard.timer);
    dismissToast(pendingDiscard.toastId);
    undoRef.current = null;
    setUndoTake(null);
  }, []);

  /**
   * Discard the last take after a 5 s Undo window; nothing is sent until it
   * closes. Then exactly the take named in the toast goes: still recording →
   * end-and-discard guarded by it; finished (even if the headset has started
   * the next one since) → discarded by its number.
   */
  const requestDiscardLast = useCallback(() => {
    if (lastTake === null || undoRef.current) return;
    const take = lastTake;
    const toastId = toast(`Discarding ${takeLabel(take).toLowerCase()}…`, {
      description: 'Undo within 5 s to keep it.',
      duration: DISCARD_UNDO_MS,
      action: { label: 'Undo', onClick: () => cancelUndo() },
    });
    const timer = setTimeout(() => {
      undoRef.current = null;
      setUndoTake(null);
      const now = liveRef.current;
      if (now?.phase === 'capturing' && now.take === take) void onDiscardLast(take);
      else void onDiscardTake(take);
    }, DISCARD_UNDO_MS);
    undoRef.current = { timer, toastId, take };
    setUndoTake(take);
  }, [lastTake, onDiscardLast, onDiscardTake, cancelUndo]);

  // Leaving the page cancels a discard that was not sent yet.
  useEffect(() => () => {
    if (undoRef.current) {
      clearTimeout(undoRef.current.timer);
      dismissToast(undoRef.current.toastId);
      undoRef.current = null;
    }
  }, []);

  // Space start/stop · N next · Backspace discard last.
  const keyState = useRef({ canTake, capturing, canDiscardLast, onStartTake, onStopTake, onNextTake, requestDiscardLast });
  keyState.current = { canTake, capturing, canDiscardLast, onStartTake, onStopTake, onNextTake, requestDiscardLast };
  useEffect(() => {
    if (!hotkeys) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.repeat || ev.ctrlKey || ev.metaKey || ev.altKey) return;
      if (isTypingTarget(ev.target)) return;
      if (isDialogOpen()) return;
      const k = keyState.current;
      if (ev.code === 'Space') {
        if (!k.canTake) return;
        ev.preventDefault();
        void (k.capturing ? k.onStopTake() : k.onStartTake());
      } else if (ev.key === 'n' || ev.key === 'N') {
        if (!k.canTake || !k.capturing) return;
        ev.preventDefault();
        void k.onNextTake();
      } else if (ev.key === 'Backspace') {
        if (!k.canDiscardLast) return;
        ev.preventDefault();
        k.requestDiscardLast();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hotkeys]);

  return { takeMode, capturing, lastTake, canTake, canDiscardLast, undoTake, requestDiscardLast, cancelUndo };
}

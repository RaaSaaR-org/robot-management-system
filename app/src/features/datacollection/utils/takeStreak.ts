/**
 * @file takeStreak.ts
 * @description The take streak (TASK-414): how many takes were kept in a row,
 *              and the best run of the session. Fed from the server's live
 *              counts (`kept`, `discarded`), so a take the recorder did not
 *              keep never extends it and a state adopted twice counts once.
 * @feature datacollection
 */

export interface TakeStreak {
  sessionId: string;
  /** Takes kept in a row since the last discard. */
  current: number;
  /** The longest finished run before the current one. */
  previousBest: number;
  /** The longest run this session, the current one included. */
  best: number;
  /** The server's `kept` / `discarded` counts this streak has taken in (high-water marks). */
  kept: number;
  discarded: number;
}

/** A fresh streak for `sessionId`. */
export function emptyStreak(sessionId: string, counts: { kept: number; discarded: number } = { kept: 0, discarded: 0 }): TakeStreak {
  return { sessionId, current: 0, previousBest: 0, best: 0, kept: counts.kept, discarded: counts.discarded };
}

/**
 * The streak after one change. `kept`: a take was kept, the run grows.
 * `discarded`: a kept take was thrown away — taken back, and the run ends.
 * `broken`: a take that was never kept was thrown away (a restart) — the run
 * ends, nothing to take back.
 */
export type StreakChange = 'kept' | 'discarded' | 'broken';

export function nextStreak(streak: TakeStreak | null, sessionId: string, change: StreakChange): TakeStreak {
  const base = streak && streak.sessionId === sessionId ? streak : emptyStreak(sessionId);
  if (change === 'kept') {
    const current = base.current + 1;
    return { ...base, current, best: Math.max(base.previousBest, current) };
  }
  // A discarded take was counted when it was kept: the run it ends is one shorter.
  const run = change === 'discarded' ? Math.max(0, base.current - 1) : base.current;
  const previousBest = Math.max(base.previousBest, run);
  return { ...base, current: 0, previousBest, best: previousBest };
}

/**
 * The streak after adopting a live state's counts. The first state seen for a
 * session only sets the baseline. States can arrive out of order (a REST poll
 * answered after a newer WebSocket event), so the counts are high-water marks:
 * an older state with fewer kept takes is ignored, and `kept` only ever drops
 * together with a discard.
 */
export function streakFromLive(
  streak: TakeStreak | null,
  next: { sessionId: string; kept: number; discarded: number },
): TakeStreak {
  if (!streak || streak.sessionId !== next.sessionId) return emptyStreak(next.sessionId, next);
  let out = streak;
  if (next.discarded > out.discarded) {
    out = nextStreak(out, next.sessionId, next.kept < out.kept ? 'discarded' : 'broken');
    out = { ...out, discarded: next.discarded, kept: Math.min(out.kept, next.kept) };
  }
  const newlyKept = next.kept - out.kept;
  for (let i = 0; i < Math.min(Math.max(0, newlyKept), 100); i++) out = nextStreak(out, next.sessionId, 'kept');
  if (newlyKept > 0) out = { ...out, kept: next.kept };
  return out;
}

/** "5 kept in a row", or null below two. */
export function streakLabel(current: number): string | null {
  return current >= 2 ? `${current} kept in a row` : null;
}

/** The session summary at End: "4 takes kept · 7.5 min · best streak 3". */
export function sessionSummary(kept: number, elapsedS: number, best: number): string {
  const minutes = Math.max(0, elapsedS) / 60;
  const time = minutes < 10 ? minutes.toFixed(1) : String(Math.round(minutes));
  return `${kept} ${kept === 1 ? 'take' : 'takes'} kept · ${time} min · best streak ${best}`;
}

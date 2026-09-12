/**
 * @file cronText.ts
 * @description Turns the common 5-field cron shapes into a sentence
 *              ("Daily at 22:00", "Mon–Fri at 07:30", "Every 15 min"), so a
 *              schedule reads as words in tables and previews. Anything it does
 *              not recognise comes back as null and the caller shows the raw
 *              expression.
 * @feature patrol
 */

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function isInt(v: string): boolean {
  return /^\d+$/.test(v);
}

function describeDays(dow: string): string | null {
  if (dow === '*') return 'Daily';
  if (dow === '1-5') return 'Mon–Fri';
  if (dow === '0,6' || dow === '6,0') return 'Weekends';
  const parts = dow.split(',');
  if (parts.every((p) => isInt(p) && Number(p) >= 0 && Number(p) <= 7)) {
    return parts.map((p) => DAY_NAMES[Number(p) % 7]).join(', ');
  }
  return null;
}

/** A sentence for a cron expression, or null when the shape is not a common one. */
export function describeCron(expr: string | null | undefined): string | null {
  if (!expr) return null;
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const [min, hour, dom, mon, dow] = fields as [string, string, string, string, string];
  if (dom !== '*' || mon !== '*') return null;

  const every = /^\*\/(\d+)$/.exec(min);
  if (every && hour === '*' && dow === '*') return `Every ${every[1]} min`;
  if (isInt(min) && hour === '*' && dow === '*') return `Hourly at :${min.padStart(2, '0')}`;

  if (isInt(min) && hour.split(',').every(isInt)) {
    const days = describeDays(dow);
    if (!days) return null;
    const times = hour
      .split(',')
      .map((h) => `${h.padStart(2, '0')}:${min.padStart(2, '0')}`)
      .join(', ');
    return `${days} at ${times}`;
  }
  return null;
}

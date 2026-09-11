/**
 * @file teamErrors.ts
 * @description Readable message from the API client's plain-object errors (they are not Error instances)
 * @feature team
 */

export function teamErrorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'message' in err) {
    const m = (err as { message: unknown }).message;
    if (typeof m === 'string' && m) return m;
  }
  return fallback;
}

export const ROLE_OPTIONS = [
  { value: 'owner', label: 'Owner — team, settings and all data' },
  { value: 'member', label: 'Member — operate robots, run training' },
  { value: 'viewer', label: 'Viewer — read-only dashboards' },
];

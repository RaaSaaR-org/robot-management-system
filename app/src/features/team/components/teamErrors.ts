/**
 * @file teamErrors.ts
 * @description Readable message from the API client's plain-object errors (they are not Error instances)
 * @feature team
 */

import { errorMessage } from '@/shared/components/ui';

/**
 * The kit's `errorMessage` (`@/shared/components/ui`) already reads this
 * client's `{ code, message, statusCode }` rejections, and also unwraps a raw
 * axios `response.data.error` — which is how the server reports a refused add.
 */
export function teamErrorMessage(err: unknown, fallback: string): string {
  return errorMessage(err, fallback);
}

export const ROLE_OPTIONS = [
  { value: 'owner', label: 'Owner — team, settings and all data' },
  { value: 'member', label: 'Member — operate robots, run training' },
  { value: 'viewer', label: 'Viewer — read-only dashboards' },
];

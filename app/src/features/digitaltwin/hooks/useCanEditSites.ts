/**
 * @file useCanEditSites.ts
 * @description Whether the signed-in user may change a site: delete it, scan or
 *   import into it, author its zones, or build its simulation scene (TASK-376).
 * @feature digitaltwin
 */

import { usePermission } from '@/features/auth/hooks/useAuth';

/**
 * Every write under `/api/digital-twins` passes `writeRoleGuard`, which admits
 * member and above. There is no site-specific permission; `robots:write` is
 * that guard's documented client mirror (TASK-284), so a viewer gets `false`.
 */
export function useCanEditSites(): boolean {
  return usePermission('robots:write');
}

/** The reason shown on a site control a viewer cannot use. */
export const SITE_EDIT_FORBIDDEN_HINT = "Your role can't change sites. Ask an operator.";

/**
 * @file SkillsPage.tsx
 * @description The skill library lives in the Skills tab of /deployments; this export only
 * forwards there so older links and imports keep working.
 * @feature deployment
 */

import { Navigate } from 'react-router-dom';

export function SkillsPage() {
  return <Navigate to="/deployments?tab=skills" replace />;
}

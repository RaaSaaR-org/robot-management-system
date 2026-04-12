/**
 * @file index.ts
 * @description Barrel export for the Team feature.
 * @feature team
 */

export { TeamPage } from './pages/TeamPage';
export { useTeamStore } from './store/teamStore';
export { teamApi } from './api/teamApi';
export type {
  TeamMember,
  AssignableRole,
  AddTeamMemberInput,
  AddTeamMemberResult,
} from './types/team.types';

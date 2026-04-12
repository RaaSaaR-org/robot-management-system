/**
 * @file team.types.ts
 * @description Shared types for the Team (tenant-scoped users) feature.
 * Mirrors the server response shape from `server/src/services/TeamService.ts`.
 * @feature team
 */

export type AssignableRole = 'owner' | 'member' | 'viewer';

export interface TeamMember {
  id: string;
  email: string;
  name: string;
  role: 'super-admin' | AssignableRole;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface AddTeamMemberInput {
  name: string;
  email: string;
  role: AssignableRole;
  /** If omitted, the server generates one. */
  tempPassword?: string;
}

export interface AddTeamMemberResult {
  member: TeamMember;
  /** Plaintext temp password — returned exactly once for the owner to copy. */
  tempPassword: string;
}

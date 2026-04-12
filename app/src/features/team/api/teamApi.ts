/**
 * @file teamApi.ts
 * @description REST client for `/api/team` endpoints.
 * @feature team
 */

import { apiClient } from '@/api/client';
import type {
  TeamMember,
  AddTeamMemberInput,
  AddTeamMemberResult,
  AssignableRole,
} from '../types/team.types';

const ENDPOINTS = {
  list: '/team',
  add: '/team',
  patch: (id: string) => `/team/${id}`,
  remove: (id: string) => `/team/${id}`,
} as const;

interface ListResponse {
  members: TeamMember[];
}

export const teamApi = {
  async list(): Promise<TeamMember[]> {
    const response = await apiClient.get<ListResponse>(ENDPOINTS.list);
    return response.data.members;
  },

  async add(input: AddTeamMemberInput): Promise<AddTeamMemberResult> {
    const response = await apiClient.post<AddTeamMemberResult>(
      ENDPOINTS.add,
      input
    );
    return response.data;
  },

  async changeRole(id: string, role: AssignableRole): Promise<TeamMember> {
    const response = await apiClient.patch<TeamMember>(ENDPOINTS.patch(id), {
      role,
    });
    return response.data;
  },

  async setActive(id: string, isActive: boolean): Promise<TeamMember> {
    const response = await apiClient.patch<TeamMember>(ENDPOINTS.patch(id), {
      isActive,
    });
    return response.data;
  },

  async deactivate(id: string): Promise<TeamMember> {
    const response = await apiClient.delete<TeamMember>(ENDPOINTS.remove(id));
    return response.data;
  },
};

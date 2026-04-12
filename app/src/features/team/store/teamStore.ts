/**
 * @file teamStore.ts
 * @description Zustand store for the Team feature — list members + mutations
 * with deduped fetches.
 * @feature team
 */

import { create } from 'zustand';
import { teamApi } from '../api/teamApi';
import type {
  TeamMember,
  AddTeamMemberInput,
  AddTeamMemberResult,
  AssignableRole,
} from '../types/team.types';

function errorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'message' in err) {
    const m = (err as { message: unknown }).message;
    if (typeof m === 'string' && m) return m;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

interface TeamState {
  members: TeamMember[];
  loaded: boolean;
  loading: boolean;
  error: string | null;

  fetch: () => Promise<void>;
  add: (input: AddTeamMemberInput) => Promise<AddTeamMemberResult>;
  changeRole: (id: string, role: AssignableRole) => Promise<void>;
  setActive: (id: string, isActive: boolean) => Promise<void>;
  reset: () => void;
}

export const useTeamStore = create<TeamState>((set, get) => ({
  members: [],
  loaded: false,
  loading: false,
  error: null,

  async fetch() {
    if (get().loading) return;
    set({ loading: true, error: null });
    try {
      const members = await teamApi.list();
      set({ members, loaded: true, loading: false });
    } catch (err) {
      set({
        error: errorMessage(err, 'Failed to load team'),
        loading: false,
      });
    }
  },

  async add(input) {
    set({ error: null });
    const result = await teamApi.add(input);
    set((state) => ({ members: [...state.members, result.member] }));
    return result;
  },

  async changeRole(id, role) {
    set({ error: null });
    const updated = await teamApi.changeRole(id, role);
    set((state) => ({
      members: state.members.map((m) => (m.id === id ? updated : m)),
    }));
  },

  async setActive(id, isActive) {
    set({ error: null });
    const updated = await teamApi.setActive(id, isActive);
    set((state) => ({
      members: state.members.map((m) => (m.id === id ? updated : m)),
    }));
  },

  reset() {
    set({ members: [], loaded: false, loading: false, error: null });
  },
}));

/**
 * @file organizationsApi.ts
 * @description REST client for `/api/tenants` endpoints.
 * @feature organizations
 */

import { apiClient } from '@/api/client';
import type {
  Organization,
  CreateOrganizationInput,
} from '../types/organizations.types';

// Note: apiClient already has /api prefix in baseURL
const ENDPOINTS = {
  list: '/tenants',
  current: '/tenants/current',
  create: '/tenants',
  onboard: '/tenants/onboard',
  delete: (id: string) => `/tenants/${id}`,
} as const;

export interface OnboardInput {
  tenant: { name: string; slug?: string; logoUrl?: string; plan?: string };
  adminUser: { email: string; name: string; password: string };
  starterResources?: { cloneRobots?: boolean };
}

export interface OnboardResult {
  tenant: Organization;
  adminUser: { id: string; email: string };
}

interface ListResponse {
  tenants: Organization[];
}

export const organizationsApi = {
  async list(): Promise<Organization[]> {
    const response = await apiClient.get<ListResponse>(ENDPOINTS.list);
    return response.data.tenants;
  },

  async getCurrent(): Promise<Organization> {
    const response = await apiClient.get<Organization>(ENDPOINTS.current);
    return response.data;
  },

  async create(input: CreateOrganizationInput): Promise<Organization> {
    const response = await apiClient.post<Organization>(ENDPOINTS.create, input);
    return response.data;
  },

  async onboard(input: OnboardInput): Promise<OnboardResult> {
    const response = await apiClient.post<OnboardResult>(ENDPOINTS.onboard, input);
    return response.data;
  },

  async delete(id: string): Promise<void> {
    await apiClient.delete(ENDPOINTS.delete(id));
  },
};

/**
 * @file index.ts
 * @description Barrel export for the Organizations feature.
 * @feature organizations
 */

export { OrganizationsPage } from './pages/OrganizationsPage';
export { useOrganizationsStore } from './store/organizationsStore';
export { organizationsApi } from './api/organizationsApi';
export type {
  Organization,
  OrganizationCounts,
  CreateOrganizationInput,
} from './types/organizations.types';

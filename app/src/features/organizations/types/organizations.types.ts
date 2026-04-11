/**
 * @file organizations.types.ts
 * @description Shared types for the Organizations (tenant) feature.
 * Mirrors the server response shape from `server/src/services/TenantService.ts`.
 * @feature organizations
 */

export interface OrganizationCounts {
  users: number;
  robots: number;
  datasets: number;
  trainingJobs: number;
}

export interface Organization {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  plan: string | null;
  settings: string;
  createdAt: string;
  updatedAt: string;
  /** True when this row is the system DEFAULT tenant (undeletable). */
  isDefault: boolean;
  counts: OrganizationCounts;
}

export interface CreateOrganizationInput {
  name: string;
  /** Optional — server will slugify `name` if omitted. */
  slug?: string;
  logoUrl?: string | null;
  plan?: string | null;
}

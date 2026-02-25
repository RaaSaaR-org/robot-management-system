/**
 * @file updatesApi.ts
 * @description API calls for secure OTA update endpoints
 * @feature updates
 */

import { apiClient } from '@/api/client';
import type {
  UpdatePackage,
  UpdateDeployment,
  UpdatePackageStatus,
  CreateUpdateRequest,
  DeployUpdateRequest,
  RollbackRequest,
} from '../types/updates.types';

// ============================================================================
// ENDPOINTS
// ============================================================================

const ENDPOINTS = {
  list: '/updates',
  byId: (id: string) => `/updates/${id}`,
  approve: (id: string) => `/updates/${id}/approve`,
  deploy: (id: string, robotId: string) => `/updates/${id}/deploy/${robotId}`,
  rollback: (id: string, robotId: string) => `/updates/${id}/rollback/${robotId}`,
  deployments: (robotId: string) => `/updates/deployments/${robotId}`,
} as const;

// ============================================================================
// API
// ============================================================================

export const updatesApi = {
  /**
   * Get all update packages with optional status filter
   */
  async getPackages(status?: UpdatePackageStatus): Promise<UpdatePackage[]> {
    const params: Record<string, string> = {};
    if (status) params.status = status;
    const response = await apiClient.get<UpdatePackage[]>(ENDPOINTS.list, { params });
    return response.data;
  },

  /**
   * Get a single update package by ID
   */
  async getPackage(id: string): Promise<UpdatePackage> {
    const response = await apiClient.get<UpdatePackage>(ENDPOINTS.byId(id));
    return response.data;
  },

  /**
   * Create a new update package
   */
  async createPackage(input: CreateUpdateRequest): Promise<UpdatePackage> {
    const response = await apiClient.post<UpdatePackage>(ENDPOINTS.list, input);
    return response.data;
  },

  /**
   * Approve an update package
   */
  async approvePackage(id: string, approverId: string): Promise<UpdatePackage> {
    const response = await apiClient.post<UpdatePackage>(ENDPOINTS.approve(id), { approverId });
    return response.data;
  },

  /**
   * Deploy an update to a robot
   */
  async deployToRobot(
    packageId: string,
    robotId: string,
    input?: DeployUpdateRequest
  ): Promise<UpdateDeployment> {
    const response = await apiClient.post<UpdateDeployment>(
      ENDPOINTS.deploy(packageId, robotId),
      input ?? {}
    );
    return response.data;
  },

  /**
   * Trigger rollback for a robot
   */
  async triggerRollback(
    packageId: string,
    robotId: string,
    input: RollbackRequest
  ): Promise<UpdateDeployment> {
    const response = await apiClient.post<UpdateDeployment>(
      ENDPOINTS.rollback(packageId, robotId),
      input
    );
    return response.data;
  },

  /**
   * Get deployment history for a robot
   */
  async getDeployments(robotId: string): Promise<UpdateDeployment[]> {
    const response = await apiClient.get<UpdateDeployment[]>(ENDPOINTS.deployments(robotId));
    return response.data;
  },
};

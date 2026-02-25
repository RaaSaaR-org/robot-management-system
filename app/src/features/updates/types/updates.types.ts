/**
 * @file updates.types.ts
 * @description TypeScript types for the secure OTA update system
 * @feature updates
 * @regulatory CRA Art. 13, MR Art. 10
 */

// ============================================================================
// ENUMS & CONSTANTS
// ============================================================================

export type UpdatePackageStatus = 'pending' | 'approved' | 'deployed' | 'rolled_back';
export type DeploymentStatus = 'pending' | 'downloading' | 'installing' | 'success' | 'failed' | 'rolled_back';

export const UPDATE_STATUS_LABELS: Record<UpdatePackageStatus, string> = {
  pending: 'Pending Approval',
  approved: 'Approved',
  deployed: 'Deployed',
  rolled_back: 'Rolled Back',
};

export const DEPLOYMENT_STATUS_LABELS: Record<DeploymentStatus, string> = {
  pending: 'Pending',
  downloading: 'Downloading',
  installing: 'Installing',
  success: 'Success',
  failed: 'Failed',
  rolled_back: 'Rolled Back',
};

export const UPDATE_STATUS_COLORS: Record<UpdatePackageStatus, string> = {
  pending: 'text-yellow-500',
  approved: 'text-blue-500',
  deployed: 'text-green-500',
  rolled_back: 'text-red-500',
};

export const DEPLOYMENT_STATUS_COLORS: Record<DeploymentStatus, string> = {
  pending: 'text-yellow-500',
  downloading: 'text-blue-400',
  installing: 'text-blue-500',
  success: 'text-green-500',
  failed: 'text-red-500',
  rolled_back: 'text-orange-500',
};

// ============================================================================
// DOMAIN INTERFACES
// ============================================================================

export interface UpdatePackage {
  id: string;
  version: string;
  changelog: string;
  signature: string;
  publicKey: string;
  checksum: string;
  fileSize: number;
  status: UpdatePackageStatus;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
}

export interface UpdateDeployment {
  id: string;
  packageId: string;
  robotId: string;
  status: DeploymentStatus;
  previousVersion: string | null;
  deployedAt: string | null;
  rolledBackAt: string | null;
  errorMessage: string | null;
  createdAt: string;
}

// ============================================================================
// INPUT TYPES
// ============================================================================

export interface CreateUpdateRequest {
  version: string;
  changelog: string;
  fileData?: string;
}

export interface ApproveUpdateRequest {
  approverId: string;
}

export interface DeployUpdateRequest {
  previousVersion?: string;
}

export interface RollbackRequest {
  targetVersion: string;
}

// ============================================================================
// STORE TYPES
// ============================================================================

export interface UpdatesState {
  packages: UpdatePackage[];
  deployments: UpdateDeployment[];
  isLoading: boolean;
  error: string | null;
}

export interface UpdatesActions {
  fetchPackages: (status?: UpdatePackageStatus) => Promise<void>;
  createPackage: (input: CreateUpdateRequest) => Promise<void>;
  approvePackage: (id: string, approverId: string) => Promise<void>;
  deployPackage: (packageId: string, robotId: string, previousVersion?: string) => Promise<void>;
  triggerRollback: (packageId: string, robotId: string, targetVersion: string) => Promise<void>;
  fetchDeployments: (robotId: string) => Promise<void>;
  reset: () => void;
}

export type UpdatesStore = UpdatesState & UpdatesActions;

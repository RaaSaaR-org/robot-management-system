/**
 * @file embodiment.types.ts
 * @description Server-side types for embodiment configuration management
 * @feature vla
 */

// ============================================================================
// DATABASE TYPES
// ============================================================================

/**
 * Embodiment entity as stored in the database
 */
export interface Embodiment {
  id: string;
  tag: string;
  manufacturer: string;
  model: string;
  description: string | null;
  configYaml: string;
  actionDim: number;
  proprioceptionDim: number;
  robotTypeId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Embodiment with related RobotType
 */
export interface EmbodimentWithRelations extends Embodiment {
  robotType?: {
    id: string;
    name: string;
    manufacturer: string;
    model: string;
  } | null;
}

// ============================================================================
// INPUT TYPES
// ============================================================================

/**
 * Input for creating a new embodiment configuration
 */
export interface CreateEmbodimentInput {
  /** Unique embodiment tag identifier */
  tag: string;
  /** Robot manufacturer name */
  manufacturer: string;
  /** Robot model name */
  model: string;
  /** Human-readable description */
  description?: string;
  /** Full YAML configuration content */
  configYaml: string;
  /** Action space dimension */
  actionDim: number;
  /** Proprioception space dimension */
  proprioceptionDim: number;
  /** Optional link to existing RobotType */
  robotTypeId?: string;
}

/**
 * Input for updating an embodiment configuration
 */
export interface UpdateEmbodimentInput {
  /** Robot manufacturer name */
  manufacturer?: string;
  /** Robot model name */
  model?: string;
  /** Human-readable description */
  description?: string;
  /** Updated YAML configuration content */
  configYaml?: string;
  /** Action space dimension */
  actionDim?: number;
  /** Proprioception space dimension */
  proprioceptionDim?: number;
  /** Link to RobotType */
  robotTypeId?: string | null;
}

// ============================================================================
// QUERY TYPES
// ============================================================================

/**
 * Query parameters for listing embodiments
 */
export interface EmbodimentQueryParams {
  /** Filter by manufacturer */
  manufacturer?: string;
  /** Filter by model */
  model?: string;
  /** Filter by linked robot type */
  robotTypeId?: string;
  /** Pagination page number */
  page?: number;
  /** Pagination page size */
  pageSize?: number;
}

/**
 * Paginated result for embodiment queries
 */
export interface PaginatedEmbodimentResult {
  data: EmbodimentWithRelations[];
  pagination: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
}

// ============================================================================
// API RESPONSE TYPES
// ============================================================================

/**
 * Embodiment API response
 */
export interface EmbodimentResponse {
  embodiment: EmbodimentWithRelations;
  message?: string;
}

/**
 * Embodiment list API response
 */
export interface EmbodimentListResponse {
  embodiments: EmbodimentWithRelations[];
  pagination: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
}

/**
 * Embodiment deletion response
 */
export interface EmbodimentDeleteResponse {
  success: boolean;
  message: string;
}

// ============================================================================
// VALIDATION TYPES
// ============================================================================

/**
 * Result of YAML configuration validation
 */
export interface YamlValidationResult {
  valid: boolean;
  errors: YamlValidationError[];
  parsedConfig?: ParsedEmbodimentConfig;
}

/**
 * YAML validation error
 */
export interface YamlValidationError {
  path: string;
  message: string;
  code: string;
}

/**
 * Parsed embodiment configuration from YAML
 * (Simplified subset of full config)
 */
export interface ParsedEmbodimentConfig {
  embodiment_tag: string;
  manufacturer: string;
  model: string;
  description?: string;
  action: {
    dim: number;
    normalization: {
      mean: number[];
      std: number[];
    };
  };
  proprioception: {
    dim: number;
    joint_names: string[];
  };
  cameras?: Array<{
    name: string;
    resolution: [number, number];
    fov?: number;
    enabled?: boolean;
  }>;
  limits?: {
    position?: {
      lower: number[];
      upper: number[];
    };
    velocity?: number[];
    torque?: number[];
  };
  safety?: {
    max_speed: number;
    workspace?: {
      type: string;
      min?: [number, number, number];
      max?: [number, number, number];
    };
  };
  version?: string;
}

// ============================================================================
// EVENT TYPES
// ============================================================================

/**
 * Embodiment service event types
 */
export type EmbodimentServiceEventType =
  | 'embodiment:created'
  | 'embodiment:updated'
  | 'embodiment:deleted'
  | 'embodiment:linked';

/**
 * Embodiment service event
 */
export interface EmbodimentServiceEvent {
  type: EmbodimentServiceEventType;
  embodimentId: string;
  tag: string;
  timestamp: string;
  data?: Record<string, unknown>;
}

/**
 * Callback for embodiment events
 */
export type EmbodimentEventCallback = (event: EmbodimentServiceEvent) => void;

/**
 * @file demoData.ts
 * @description Mock data for demo mode — H1 humanoid fleet with telemetry, alerts, and zones
 * @feature mocks
 */

import type { Robot, RobotTelemetry, JointState } from '@/features/robots/types';
import type { Alert } from '@/features/alerts/types';
import type { Zone } from '@/features/fleet/types';

// ============================================================================
// H1 HUMANOID — Primary Demo Robot
// ============================================================================

const H1_JOINT_STATES: JointState[] = [
  // Left Leg (5)
  { name: 'left_hip_yaw_joint', position: 0.02, velocity: 0.0, effort: 12.5 },
  { name: 'left_hip_roll_joint', position: -0.01, velocity: 0.0, effort: 15.3 },
  { name: 'left_hip_pitch_joint', position: -0.35, velocity: 0.1, effort: 45.2 },
  { name: 'left_knee_joint', position: 0.72, velocity: 0.05, effort: 38.7 },
  { name: 'left_ankle_joint', position: -0.18, velocity: 0.0, effort: 22.1 },
  // Right Leg (5)
  { name: 'right_hip_yaw_joint', position: -0.02, velocity: 0.0, effort: 13.1 },
  { name: 'right_hip_roll_joint', position: 0.01, velocity: 0.0, effort: 14.8 },
  { name: 'right_hip_pitch_joint', position: -0.33, velocity: -0.1, effort: 44.6 },
  { name: 'right_knee_joint', position: 0.70, velocity: -0.05, effort: 39.2 },
  { name: 'right_ankle_joint', position: -0.17, velocity: 0.0, effort: 21.8 },
  // Torso (1)
  { name: 'torso_joint', position: 0.0, velocity: 0.0, effort: 8.4 },
  // Left Arm (4)
  { name: 'left_shoulder_pitch_joint', position: 0.15, velocity: 0.0, effort: 6.2 },
  { name: 'left_shoulder_roll_joint', position: 0.30, velocity: 0.0, effort: 4.8 },
  { name: 'left_shoulder_yaw_joint', position: -0.10, velocity: 0.0, effort: 3.1 },
  { name: 'left_elbow_joint', position: -0.45, velocity: 0.0, effort: 5.5 },
  // Right Arm (4)
  { name: 'right_shoulder_pitch_joint', position: 0.12, velocity: 0.0, effort: 6.0 },
  { name: 'right_shoulder_roll_joint', position: -0.28, velocity: 0.0, effort: 4.5 },
  { name: 'right_shoulder_yaw_joint', position: 0.08, velocity: 0.0, effort: 3.3 },
  { name: 'right_elbow_joint', position: -0.42, velocity: 0.0, effort: 5.2 },
];

export const DEMO_H1_ROBOT: Robot = {
  id: 'demo-h1-001',
  name: 'Atlas H1',
  model: 'Unitree H1',
  serialNumber: 'UH1-2025-DEMO-001',
  status: 'online',
  batteryLevel: 78,
  location: { x: 5.2, y: 3.8, z: 0.0, floor: '1', zone: 'Assembly Hall', heading: 45 },
  lastSeen: new Date().toISOString(),
  currentTaskId: 'task-demo-001',
  currentTaskName: 'Warehouse Inspection Route B',
  capabilities: [
    'navigation', 'manipulation', 'inspection',
    'voice_command', 'object_detection', 'vla_inference',
  ],
  firmware: 'v2.4.1-stable',
  ipAddress: '192.168.1.101',
  metadata: {
    embodiment: 'unitree_h1',
    manufacturer: 'Unitree',
    actionDim: 19,
    proprioceptionDim: 38,
    vlaModel: 'gr00t-n1-2b',
  },
  a2aEnabled: true,
  a2aAgentUrl: 'http://192.168.1.101:41243',
  createdAt: '2025-06-15T08:00:00.000Z',
  updatedAt: new Date().toISOString(),
};

export const DEMO_H1_TELEMETRY: RobotTelemetry = {
  robotId: 'demo-h1-001',
  robotType: 'h1',
  batteryLevel: 78,
  batteryVoltage: 48.2,
  batteryTemperature: 32.5,
  powerSource: 'battery',
  cpuUsage: 42.3,
  memoryUsage: 61.7,
  diskUsage: 35.2,
  temperature: 38.4,
  humidity: 45.0,
  speed: 0.8,
  sensors: {
    imu_connected: true,
    lidar_connected: true,
    camera_head_fps: 30,
    force_left_foot: 245.3,
    force_right_foot: 238.7,
    obstacle_distance: 2.4,
  },
  jointStates: H1_JOINT_STATES,
  errors: [],
  warnings: [],
  timestamp: new Date().toISOString(),
};

// ============================================================================
// FLEET (5 Robots)
// ============================================================================

export const DEMO_ROBOTS: Robot[] = [
  DEMO_H1_ROBOT,
  {
    id: 'demo-so101-001',
    name: 'Arm SO-101',
    model: 'SO-ARM100 SO-101',
    serialNumber: 'SO101-2025-DEMO-001',
    status: 'busy',
    batteryLevel: null, // AC-powered
    location: { x: 2.0, y: 1.5, floor: '1', zone: 'Lab Bench A' },
    lastSeen: new Date().toISOString(),
    currentTaskId: 'task-demo-002',
    currentTaskName: 'Pick and Place — Component Sorting',
    capabilities: ['manipulation', 'object_detection', 'vla_inference'],
    firmware: 'v1.8.0',
    ipAddress: '192.168.1.102',
    metadata: { embodiment: 'so101_arm', manufacturer: 'SO-ARM100', actionDim: 6 },
    a2aEnabled: true,
    a2aAgentUrl: 'http://192.168.1.102:41243',
    createdAt: '2025-08-01T10:00:00.000Z',
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'demo-g1-001',
    name: 'Scout G1',
    model: 'Unitree G1',
    serialNumber: 'UG1-2025-DEMO-001',
    status: 'online',
    batteryLevel: 92,
    location: { x: 12.0, y: 8.5, floor: '2', zone: 'Corridor B', heading: 180 },
    lastSeen: new Date().toISOString(),
    capabilities: ['navigation', 'inspection', 'voice_command'],
    firmware: 'v3.1.0',
    ipAddress: '192.168.1.103',
    metadata: { embodiment: 'unitree_g1', manufacturer: 'Unitree', actionDim: 29 },
    a2aEnabled: true,
    createdAt: '2025-09-20T14:00:00.000Z',
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'demo-h1-002',
    name: 'Titan H1-B',
    model: 'Unitree H1',
    serialNumber: 'UH1-2025-DEMO-002',
    status: 'charging',
    batteryLevel: 23,
    location: { x: 1.0, y: 1.0, floor: '1', zone: 'Charging Station' },
    lastSeen: new Date(Date.now() - 120000).toISOString(),
    capabilities: ['navigation', 'manipulation', 'heavy_lift'],
    firmware: 'v2.4.1-stable',
    ipAddress: '192.168.1.104',
    metadata: { embodiment: 'unitree_h1', manufacturer: 'Unitree', actionDim: 19 },
    a2aEnabled: false,
    createdAt: '2025-07-10T09:00:00.000Z',
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'demo-generic-001',
    name: 'Patrol Bot',
    model: 'Generic AMR',
    status: 'offline',
    batteryLevel: 5,
    location: { x: 0, y: 0, floor: '1', zone: 'Storage' },
    lastSeen: new Date(Date.now() - 86400000).toISOString(),
    capabilities: ['navigation'],
    firmware: 'v1.0.0',
    metadata: { embodiment: 'generic' },
    a2aEnabled: false,
    createdAt: '2025-05-01T12:00:00.000Z',
    updatedAt: new Date(Date.now() - 86400000).toISOString(),
  },
];

// ============================================================================
// ALERTS (3)
// ============================================================================

export const DEMO_ALERTS: Alert[] = [
  {
    id: 'demo-alert-001',
    severity: 'critical',
    title: 'H1 Temperature Warning',
    message: 'Atlas H1 core temperature has reached 78.4\u00B0C — approaching thermal threshold (80\u00B0C). Reduce workload or initiate cooldown.',
    source: 'robot',
    sourceId: 'demo-h1-001',
    timestamp: new Date(Date.now() - 300000).toISOString(),
    acknowledged: false,
    dismissable: false,
  },
  {
    id: 'demo-alert-002',
    severity: 'warning',
    title: 'SO-101 Joint Limit Near',
    message: 'Arm SO-101 left_shoulder_roll_joint at 95% of position limit. Consider recalibrating workspace bounds.',
    source: 'robot',
    sourceId: 'demo-so101-001',
    timestamp: new Date(Date.now() - 600000).toISOString(),
    acknowledged: false,
    dismissable: true,
  },
  {
    id: 'demo-alert-003',
    severity: 'info',
    title: 'G1 Route Completed',
    message: 'Scout G1 has completed inspection route "Corridor B — Full Sweep". No anomalies detected.',
    source: 'robot',
    sourceId: 'demo-g1-001',
    timestamp: new Date(Date.now() - 900000).toISOString(),
    acknowledged: false,
    dismissable: true,
  },
];

// ============================================================================
// ZONES (4)
// ============================================================================

export const DEMO_ZONES: Zone[] = [
  {
    id: 'demo-zone-001',
    name: 'Assembly Hall',
    floor: '1',
    bounds: { x: 0, y: 0, width: 20, height: 15 },
    type: 'operational',
    description: 'Main assembly area for robot operations',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'demo-zone-002',
    name: 'Lab Bench A',
    floor: '1',
    bounds: { x: 0, y: 15, width: 10, height: 10 },
    type: 'operational',
    description: 'Robot arm workbench for precision tasks',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'demo-zone-003',
    name: 'Charging Station',
    floor: '1',
    bounds: { x: 10, y: 15, width: 10, height: 10 },
    type: 'charging',
    description: 'Battery charging and power management area',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'demo-zone-004',
    name: 'Storage',
    floor: '1',
    bounds: { x: 20, y: 0, width: 15, height: 15 },
    type: 'maintenance',
    description: 'Equipment storage and offline robot parking',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: new Date().toISOString(),
  },
];

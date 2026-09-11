/**
 * @file simFormat.ts
 * @description Shared labels, tones and glossary for the simulation section
 * @feature simulation
 */

import type { Tone } from '@/shared/components/ui';
import { getSimBackendMode, type SimJob, type SimScene } from '../types';

/** Hover explanations for domain terms (InfoIcon content). */
export const GLOSSARY = {
  modelId:
    'A label to find this run later. It does not choose the model: the VLA server loads the model set in VLA_MODEL_PATH.',
  scene:
    'Built-in scenes ship with the platform; scanned-room scenes come from a digital twin. The scene decides the physics backend and the robot.',
  rolloutCount:
    'How many independent attempts to run. Each one randomizes the object start. More rollouts give a more reliable success rate.',
  successRate: 'Share of episodes where the robot met the success criterion before the 200-step timeout.',
  avgSteps: 'Average control ticks before success or timeout (max 200). At the cap, the policy did not finish in time.',
  collisions: 'Contact events between gripper and object across all episodes. Many suggest bumping rather than grasping.',
  avgDuration: 'Average wall-clock time per episode, including calls to the VLA server.',
  frames: 'Camera images captured during episodes: exactly the pixels the VLA server received.',
  simToReal: 'The drop in success rate from simulation to a real robot, measured from logged real test runs.',
} as const;

/** ≥80 % is strong, ≥50 % partial, below that weak. */
export function successTone(rate: number): Tone {
  if (rate >= 0.8) return 'success';
  if (rate >= 0.5) return 'warning';
  return 'danger';
}

export function formatPct(rate: number, digits = 0): string {
  return `${(rate * 100).toFixed(digits)}%`;
}

export function formatSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  return `${Math.floor(seconds / 60)} min ${(seconds % 60).toFixed(0)} s`;
}

export function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} d ago`;
  return new Date(iso).toLocaleDateString();
}

/** "smolvla-so101-v2 on G1 Apple to Plate" — model label, then the scene's name. */
export function runName(job: SimJob, scenes: SimScene[]): string {
  const scene = scenes.find((s) => s.id === job.sceneId);
  return `${job.modelId} on ${scene?.name ?? job.environment}`;
}

export function backendLabel(backend: string): string {
  return backend === 'isaac' ? 'Isaac Lab' : backend === 'mujoco' ? 'MuJoCo' : backend;
}

/** Mock results are gated (amber "Mock"); a real simulator run is Sim. */
export function backendModeTag(job: SimJob): { tone: Tone; label: string } | null {
  const mode = getSimBackendMode(job);
  if (!mode) return null;
  return mode === 'mock' ? { tone: 'warning', label: 'Mock' } : { tone: 'info', label: 'Sim' };
}

/** One sentence on what a success rate means for deployment. */
export function successInterpretation(rate: number): { label: string; detail: string } {
  if (rate >= 0.8) return { label: 'Strong', detail: 'The policy reliably solves this task. Consider a sim-to-real test next.' };
  if (rate >= 0.5) return { label: 'Partial', detail: 'It solves the task more often than not, but not reliably enough to deploy. Train more or fine-tune.' };
  if (rate > 0) return { label: 'Weak', detail: 'It occasionally solves the task. It likely needs more in-domain data or task-specific fine-tuning.' };
  return {
    label: 'No successes',
    detail: 'No episode succeeded. Common causes: not trained on this scene, a camera or gripper gap between sim and real, or an action normalization mismatch. Check the frame replay.',
  };
}

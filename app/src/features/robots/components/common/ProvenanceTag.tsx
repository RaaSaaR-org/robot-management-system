/**
 * @file ProvenanceTag.tsx
 * @description Where a telemetry value comes from — live hardware, simulation, stale
 *   or no telemetry at all — as a kit StatusTag. The only provenance marker in the feature.
 * @feature robots
 */

import { StatusTag } from '@/shared/components/ui';
import type { RobotTelemetry } from '../../types/robots.types';

export type ProvenanceSource = 'live' | 'sim' | 'none' | 'stale';

export interface ProvenanceTagProps {
  source: ProvenanceSource;
  className?: string;
}

/** Provenance of the telemetry shown next to it. */
export function ProvenanceTag({ source, className }: ProvenanceTagProps) {
  switch (source) {
    case 'live':
      return <StatusTag tone="live" dot pulse className={className}>Live</StatusTag>;
    case 'sim':
      return <StatusTag tone="sim" className={className}>Sim</StatusTag>;
    case 'stale':
      return <StatusTag tone="gated" className={className}>Stale</StatusTag>;
    default:
      return <StatusTag tone="neutral" className={className}>No telemetry</StatusTag>;
  }
}

/**
 * Provenance of a telemetry frame: `none` without a frame, `sim` when the frame
 * is simulated (per the TASK-184 contract: `simulated` lists groups, else
 * `hardwareConnected !== true`), otherwise `live`.
 */
export function provenanceOf(
  telemetry: RobotTelemetry | null | undefined,
  _isConnected?: boolean,
): ProvenanceSource {
  if (!telemetry) return 'none';
  const simulated =
    telemetry.simulated !== undefined
      ? telemetry.simulated.length > 0
      : telemetry.hardwareConnected !== true;
  return simulated ? 'sim' : 'live';
}

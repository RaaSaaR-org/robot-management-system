/**
 * @file RobotErrorBanner.tsx
 * @description Banner component for displaying robot errors, warnings, and maintenance notices
 * @feature robots
 */

import type { Robot, RobotTelemetry } from '../types/robots.types';

// ============================================================================
// TYPES
// ============================================================================

export interface RobotErrorBannerProps {
  /** Robot data */
  robot: Robot;
  /** Telemetry data with errors/warnings */
  telemetry: RobotTelemetry | null;
}

// ============================================================================
// ICONS
// ============================================================================

const WarningIcon = (
  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
  </svg>
);

const MaintenanceIcon = (
  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);

// ============================================================================
// COMPONENT
// ============================================================================

export function RobotErrorBanner({ robot, telemetry }: RobotErrorBannerProps) {
  const errorCode = robot.metadata?.errorCode as string | undefined;
  const errorMessage = robot.metadata?.errorMessage as string | undefined;
  const maintenanceReason = robot.metadata?.maintenanceReason as string | undefined;

  const hasErrors = telemetry?.errors?.length || errorCode;
  const hasWarnings = telemetry?.warnings?.length;
  const hasMaintenance = maintenanceReason;

  // Don't render anything if no issues
  if (!hasErrors && !hasWarnings && !hasMaintenance) {
    return null;
  }

  return (
    <div className="space-y-3">
      {/* Critical Errors */}
      {hasErrors && (
        <div className="flex items-start gap-4 p-4 rounded-xl glass-subtle border-red-500/30 bg-red-500/10">
          <div className="p-2 rounded-lg glass-subtle border-red-500/20">
            <span className="text-red-400">{WarningIcon}</span>
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-red-400">Error Detected</h3>
            <div className="mt-1 space-y-1">
              {errorCode && (
                <p className="text-sm text-red-300/80">
                  <span className="font-mono font-medium text-red-300">
                    {errorCode}
                  </span>
                  {errorMessage && `: ${errorMessage}`}
                </p>
              )}
              {telemetry?.errors?.map((err, i) => (
                <p key={i} className="text-sm text-red-300/80 font-mono">{err}</p>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Warnings */}
      {hasWarnings && (
        <div className="flex items-start gap-4 p-4 rounded-xl glass-subtle border-yellow-500/30 bg-yellow-500/10">
          <div className="p-2 rounded-lg glass-subtle border-yellow-500/20">
            <span className="text-yellow-400">{WarningIcon}</span>
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-yellow-400">Warnings</h3>
            <div className="mt-1 space-y-1">
              {telemetry?.warnings?.map((warn, i) => (
                <p key={i} className="text-sm text-yellow-300/80">{warn}</p>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Maintenance Notice */}
      {hasMaintenance && (
        <div className="flex items-start gap-4 p-4 rounded-xl glass-subtle border-orange-500/30 bg-orange-500/10">
          <div className="p-2 rounded-lg glass-subtle border-orange-500/20">
            <span className="text-orange-400">{MaintenanceIcon}</span>
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-orange-400">Maintenance Mode</h3>
            <p className="mt-1 text-sm text-orange-300/80">
              {maintenanceReason}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

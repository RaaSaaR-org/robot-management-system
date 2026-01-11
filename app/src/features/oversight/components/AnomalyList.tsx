/**
 * @file AnomalyList.tsx
 * @description List of anomalies with acknowledge and resolve actions
 * @feature oversight
 */

import { useState } from 'react';
import { CheckCircle, Eye } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { Button } from '@/shared/components/ui/Button';
import { Badge } from '@/shared/components/ui/Badge';
import { AnomalyIndicator } from './AnomalyIndicator';
import type { AnomalyRecord, AnomalyType } from '../types';

// ============================================================================
// TYPES
// ============================================================================

export interface AnomalyListProps {
  anomalies: AnomalyRecord[];
  isLoading?: boolean;
  onAcknowledge: (anomalyId: string) => Promise<void>;
  onResolve: (anomalyId: string, resolution: string) => Promise<void>;
  className?: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const ANOMALY_TYPE_LABELS: Record<AnomalyType, string> = {
  confidence_drop: 'Confidence Drop',
  behavior_drift: 'Behavior Drift',
  performance_degradation: 'Performance Degradation',
  safety_warning: 'Safety Warning',
  communication_loss: 'Communication Loss',
  sensor_malfunction: 'Sensor Malfunction',
};

// ============================================================================
// SUB-COMPONENT
// ============================================================================

interface AnomalyCardProps {
  anomaly: AnomalyRecord;
  onAcknowledge: () => Promise<void>;
  onResolve: (resolution: string) => Promise<void>;
}

function AnomalyCard({ anomaly, onAcknowledge, onResolve }: AnomalyCardProps) {
  const [isAcknowledging, setIsAcknowledging] = useState(false);
  const [isResolving, setIsResolving] = useState(false);
  const [showResolve, setShowResolve] = useState(false);
  const [resolution, setResolution] = useState('');

  const handleAcknowledge = async () => {
    setIsAcknowledging(true);
    try {
      await onAcknowledge();
    } finally {
      setIsAcknowledging(false);
    }
  };

  const handleResolve = async () => {
    if (!resolution.trim()) return;
    setIsResolving(true);
    try {
      await onResolve(resolution);
      setShowResolve(false);
      setResolution('');
    } finally {
      setIsResolving(false);
    }
  };

  const isAcknowledged = !!anomaly.acknowledgedAt;
  const timeAgo = formatTimeAgo(new Date(anomaly.detectedAt));

  return (
    <div
      className={cn(
        'p-4 rounded-lg border',
        anomaly.severity === 'critical'
          ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
          : anomaly.severity === 'high'
            ? 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800'
            : 'bg-theme-elevated border-theme-subtle'
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <AnomalyIndicator severity={anomaly.severity} size="sm" />
            <span className="font-medium text-theme-primary">
              {ANOMALY_TYPE_LABELS[anomaly.anomalyType]}
            </span>
            {anomaly.robotName && (
              <Badge variant="default">{anomaly.robotName}</Badge>
            )}
          </div>

          <p className="mt-2 text-sm text-theme-secondary">
            {anomaly.description}
          </p>

          <div className="mt-2 flex items-center gap-4 text-xs text-theme-muted">
            <span>Detected {timeAgo}</span>
            {isAcknowledged && (
              <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
                <Eye className="h-3 w-3" />
                Acknowledged
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {!isAcknowledged && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleAcknowledge}
              disabled={isAcknowledging}
            >
              <Eye className="h-4 w-4 mr-1" />
              Acknowledge
            </Button>
          )}
          <Button
            variant="primary"
            size="sm"
            onClick={() => setShowResolve(!showResolve)}
          >
            <CheckCircle className="h-4 w-4 mr-1" />
            Resolve
          </Button>
        </div>
      </div>

      {showResolve && (
        <div className="mt-4 pt-4 border-t border-theme-subtle">
          <label className="block text-sm font-medium text-theme-primary mb-2">
            Resolution
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
              placeholder="Describe how this anomaly was resolved..."
              className="flex-1 px-3 py-2 text-sm rounded-md border border-theme-subtle bg-theme-bg text-theme-primary placeholder:text-theme-muted focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <Button
              variant="primary"
              size="sm"
              onClick={handleResolve}
              disabled={isResolving || !resolution.trim()}
            >
              {isResolving ? 'Resolving...' : 'Submit'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// HELPERS
// ============================================================================

function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
  return `${Math.floor(diffMins / 1440)}d ago`;
}

// ============================================================================
// COMPONENT
// ============================================================================

export function AnomalyList({
  anomalies,
  isLoading,
  onAcknowledge,
  onResolve,
  className,
}: AnomalyListProps) {
  if (isLoading) {
    return (
      <div className={cn('space-y-3', className)}>
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-24 rounded-lg bg-theme-elevated animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (anomalies.length === 0) {
    return (
      <div className={cn('text-center py-8', className)}>
        <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-3" />
        <p className="text-theme-secondary font-medium">No active anomalies</p>
        <p className="text-sm text-theme-muted">All systems operating normally</p>
      </div>
    );
  }

  return (
    <div className={cn('space-y-3', className)}>
      {anomalies.map((anomaly) => (
        <AnomalyCard
          key={anomaly.id}
          anomaly={anomaly}
          onAcknowledge={() => onAcknowledge(anomaly.id)}
          onResolve={(resolution) => onResolve(anomaly.id, resolution)}
        />
      ))}
    </div>
  );
}

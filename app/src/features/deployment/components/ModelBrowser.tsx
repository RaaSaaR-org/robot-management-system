/**
 * @file ModelBrowser.tsx
 * @description Browser for model versions grouped by skill with filtering
 * @feature deployment
 */

import { useState, useMemo } from 'react';
import { Card, Input, Badge } from '@/shared/components/ui';
import { cn } from '@/shared/utils';
import type { ModelVersion } from '../types';
import { ModelVersionCard } from './ModelVersionCard';

export interface ModelBrowserProps {
  modelVersions: ModelVersion[];
  selectedVersionId?: string;
  onSelectVersion?: (version: ModelVersion) => void;
  isLoading?: boolean;
  className?: string;
}

type StatusFilter = 'all' | 'staging' | 'production' | 'archived';

interface GroupedVersions {
  skillId: string;
  skillName: string;
  versions: ModelVersion[];
}

export function ModelBrowser({
  modelVersions,
  selectedVersionId,
  onSelectVersion,
  isLoading = false,
  className,
}: ModelBrowserProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  // Filter versions
  const filteredVersions = useMemo(() => {
    return modelVersions.filter((version) => {
      // Status filter
      if (statusFilter !== 'all' && version.deploymentStatus !== statusFilter) {
        return false;
      }

      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const skillName = version.skill?.name?.toLowerCase() || '';
        const versionStr = version.version.toLowerCase();
        return skillName.includes(query) || versionStr.includes(query);
      }

      return true;
    });
  }, [modelVersions, statusFilter, searchQuery]);

  // Group by skill
  const groupedVersions = useMemo(() => {
    const groups = new Map<string, GroupedVersions>();

    filteredVersions.forEach((version) => {
      const skillId = version.skillId;
      const skillName = version.skill?.name || 'Unknown Skill';

      if (!groups.has(skillId)) {
        groups.set(skillId, {
          skillId,
          skillName,
          versions: [],
        });
      }

      groups.get(skillId)!.versions.push(version);
    });

    // Sort versions within each group by version number (descending)
    groups.forEach((group) => {
      group.versions.sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
    });

    return Array.from(groups.values()).sort((a, b) => a.skillName.localeCompare(b.skillName));
  }, [filteredVersions]);

  const statusCounts = useMemo(() => {
    return modelVersions.reduce(
      (acc, v) => {
        acc[v.deploymentStatus] = (acc[v.deploymentStatus] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );
  }, [modelVersions]);

  return (
    <div className={cn('space-y-4', className)}>
      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1">
          <Input
            placeholder="Search skills or versions..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full"
          />
        </div>

        <div className="flex gap-2">
          {(['all', 'staging', 'production', 'archived'] as StatusFilter[]).map((status) => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={cn(
                'px-3 py-1.5 text-sm rounded-md transition-colors',
                statusFilter === status
                  ? 'bg-cobalt-500 text-white'
                  : 'bg-gray-100 dark:bg-gray-800 text-theme-secondary hover:bg-gray-200 dark:hover:bg-gray-700'
              )}
            >
              {status.charAt(0).toUpperCase() + status.slice(1)}
              {status !== 'all' && statusCounts[status] ? ` (${statusCounts[status]})` : ''}
            </button>
          ))}
        </div>
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="flex justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cobalt-500" />
        </div>
      )}

      {/* Empty state */}
      {!isLoading && filteredVersions.length === 0 && (
        <Card className="text-center py-12">
          <svg
            className="w-12 h-12 mx-auto text-theme-tertiary mb-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
            />
          </svg>
          <p className="text-theme-secondary">
            {searchQuery || statusFilter !== 'all'
              ? 'No model versions match your filters'
              : 'No model versions available'}
          </p>
        </Card>
      )}

      {/* Grouped versions */}
      {!isLoading && groupedVersions.length > 0 && (
        <div className="space-y-6">
          {groupedVersions.map((group) => (
            <div key={group.skillId} className="space-y-3">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-theme-primary">{group.skillName}</h3>
                <Badge variant="default" size="sm">
                  {group.versions.length} version(s)
                </Badge>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {group.versions.map((version) => (
                  <ModelVersionCard
                    key={version.id}
                    version={version}
                    selected={selectedVersionId === version.id}
                    onClick={() => onSelectVersion?.(version)}
                    compact
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

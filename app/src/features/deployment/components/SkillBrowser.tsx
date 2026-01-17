/**
 * @file SkillBrowser.tsx
 * @description Grid browser for skills with filtering capabilities
 * @feature deployment
 */

import { useState, useMemo } from 'react';
import { Card, Input, Badge, Button } from '@/shared/components/ui';
import { cn } from '@/shared/utils';
import type { SkillDefinition, SkillStatus } from '../types';
import { SkillCard } from './SkillCard';

export interface SkillBrowserProps {
  skills: SkillDefinition[];
  selectedSkillId?: string;
  onSelectSkill?: (skill: SkillDefinition) => void;
  onCreateSkill?: () => void;
  onEditSkill?: (skill: SkillDefinition) => void;
  isLoading?: boolean;
  className?: string;
}

type StatusFilter = 'all' | SkillStatus;

export function SkillBrowser({
  skills,
  selectedSkillId,
  onSelectSkill,
  onCreateSkill,
  onEditSkill,
  isLoading = false,
  className,
}: SkillBrowserProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [capabilityFilter, setCapabilityFilter] = useState<string>('');

  // Get unique capabilities
  const allCapabilities = useMemo(() => {
    const caps = new Set<string>();
    skills.forEach((skill) => {
      skill.requiredCapabilities.forEach((cap) => caps.add(cap));
    });
    return Array.from(caps).sort();
  }, [skills]);

  // Filter skills
  const filteredSkills = useMemo(() => {
    return skills.filter((skill) => {
      // Status filter
      if (statusFilter !== 'all' && skill.status !== statusFilter) {
        return false;
      }

      // Capability filter
      if (capabilityFilter && !skill.requiredCapabilities.includes(capabilityFilter)) {
        return false;
      }

      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const name = skill.name.toLowerCase();
        const description = skill.description?.toLowerCase() || '';
        return name.includes(query) || description.includes(query);
      }

      return true;
    });
  }, [skills, statusFilter, capabilityFilter, searchQuery]);

  const statusCounts = useMemo(() => {
    return skills.reduce(
      (acc, s) => {
        acc[s.status] = (acc[s.status] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );
  }, [skills]);

  return (
    <div className={cn('space-y-4', className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-theme-primary">Skills</h2>
        {onCreateSkill && (
          <Button variant="primary" size="sm" onClick={onCreateSkill}>
            <svg className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New Skill
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1">
          <Input
            placeholder="Search skills..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full"
          />
        </div>

        <select
          value={capabilityFilter}
          onChange={(e) => setCapabilityFilter(e.target.value)}
          className="px-3 py-2 text-sm rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-theme-primary"
        >
          <option value="">All Capabilities</option>
          {allCapabilities.map((cap) => (
            <option key={cap} value={cap}>
              {cap}
            </option>
          ))}
        </select>
      </div>

      {/* Status filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {(['all', 'draft', 'published', 'deprecated', 'archived'] as StatusFilter[]).map((status) => (
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

      {/* Loading state */}
      {isLoading && (
        <div className="flex justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cobalt-500" />
        </div>
      )}

      {/* Empty state */}
      {!isLoading && filteredSkills.length === 0 && (
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
              d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"
            />
          </svg>
          <p className="text-theme-secondary mb-4">
            {searchQuery || statusFilter !== 'all' || capabilityFilter
              ? 'No skills match your filters'
              : 'No skills available'}
          </p>
          {onCreateSkill && !searchQuery && statusFilter === 'all' && !capabilityFilter && (
            <Button variant="primary" onClick={onCreateSkill}>
              Create your first skill
            </Button>
          )}
        </Card>
      )}

      {/* Skills grid */}
      {!isLoading && filteredSkills.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredSkills.map((skill) => (
            <SkillCard
              key={skill.id}
              skill={skill}
              selected={selectedSkillId === skill.id}
              onClick={() => {
                onSelectSkill?.(skill);
                onEditSkill?.(skill);
              }}
            />
          ))}
        </div>
      )}

      {/* Summary */}
      {!isLoading && filteredSkills.length > 0 && (
        <div className="flex items-center justify-between text-sm text-theme-secondary">
          <span>
            Showing {filteredSkills.length} of {skills.length} skills
          </span>
          {statusCounts.published && (
            <Badge variant="success" size="sm">
              {statusCounts.published} published
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}

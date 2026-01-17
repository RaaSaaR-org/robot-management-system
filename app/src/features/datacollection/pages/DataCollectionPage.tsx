/**
 * @file DataCollectionPage.tsx
 * @description Main data collection page with sessions and priorities tabs
 * @feature datacollection
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/shared/utils/cn';
import { Video, Target, BarChart3 } from 'lucide-react';
import { SessionList } from '../components/SessionList';
import { PriorityDashboard } from '../components/PriorityDashboard';
import { UncertaintyHeatmap } from '../components/UncertaintyHeatmap';
import {
  useTeleoperationSessions,
  useCollectionPriorities,
  useUncertaintyAnalysis,
} from '../hooks/datacollection';

// ============================================================================
// TYPES
// ============================================================================

type TabId = 'sessions' | 'priorities' | 'uncertainty';

interface Tab {
  id: TabId;
  label: string;
  icon: typeof Video;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const TABS: Tab[] = [
  { id: 'sessions', label: 'Sessions', icon: Video },
  { id: 'priorities', label: 'Collection Priorities', icon: Target },
  { id: 'uncertainty', label: 'Uncertainty Analysis', icon: BarChart3 },
];

// Default model ID for demo purposes
const DEFAULT_MODEL_ID = 'default-model';

// ============================================================================
// COMPONENT
// ============================================================================

export function DataCollectionPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabId>('sessions');

  // Hooks
  const {
    sessions,
    filters,
    pagination,
    isLoading: sessionsLoading,
    setFilters,
    clearFilters,
    setPage,
  } = useTeleoperationSessions();

  const {
    priorities,
    isLoading: prioritiesLoading,
  } = useCollectionPriorities(DEFAULT_MODEL_ID);

  const {
    analysis,
    isLoading: analysisLoading,
  } = useUncertaintyAnalysis(DEFAULT_MODEL_ID);

  const handleSessionClick = (session: { id: string }) => {
    navigate(`/data-collection/sessions/${session.id}`);
  };

  const handleNewSession = () => {
    navigate('/data-collection/new');
  };

  return (
    <div className="container mx-auto px-4 py-6 max-w-7xl">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          Data Collection
        </h1>
        <p className="text-gray-600 dark:text-gray-400 mt-1">
          Collect teleoperation data and view collection priorities
        </p>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 dark:border-gray-700 mb-6">
        <nav className="flex space-x-8">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;

            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'flex items-center gap-2 py-4 px-1 border-b-2 font-medium text-sm transition-colors',
                  isActive
                    ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                    : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
                )}
              >
                <Icon size={18} />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab Content */}
      <div className="min-h-[500px]">
        {activeTab === 'sessions' && (
          <SessionList
            sessions={sessions}
            filters={filters}
            pagination={pagination}
            isLoading={sessionsLoading}
            onFilterChange={setFilters}
            onClearFilters={clearFilters}
            onPageChange={setPage}
            onSessionClick={handleSessionClick}
            onNewSession={handleNewSession}
          />
        )}

        {activeTab === 'priorities' && (
          <PriorityDashboard
            priorities={priorities}
            isLoading={prioritiesLoading}
          />
        )}

        {activeTab === 'uncertainty' && (
          <UncertaintyHeatmap
            analysis={analysis}
            isLoading={analysisLoading}
          />
        )}
      </div>
    </div>
  );
}

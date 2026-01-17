/**
 * @file FleetLearningPage.tsx
 * @description Main page for fleet learning (federated learning) feature
 * @feature fleetlearning
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/shared/utils/cn';
import {
  Network,
  Plus,
  Filter,
  RefreshCw,
  TrendingUp,
  Shield,
  Users,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { FederatedRoundCard } from '../components/FederatedRoundCard';
import { ConvergenceChart } from '../components/ConvergenceChart';
import { PrivacyBudgetView } from '../components/PrivacyBudgetView';
import { ROHEDashboard } from '../components/ROHEDashboard';
import { CreateRoundModal } from '../components/CreateRoundModal';
import {
  useFederatedRounds,
  useConvergenceData,
  usePrivacyBudgets,
  useROHEMetrics,
  useCreateRound,
} from '../hooks/fleetlearning';
import type { FederatedRoundStatus, CreateFederatedRoundRequest } from '../types/fleetlearning.types';

// ============================================================================
// TYPES
// ============================================================================

type TabType = 'rounds' | 'convergence' | 'privacy' | 'rohe';

// ============================================================================
// COMPONENT
// ============================================================================

export function FleetLearningPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabType>('rounds');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [statusFilter, setStatusFilter] = useState<FederatedRoundStatus | ''>('');

  // Hooks
  const {
    rounds,
    activeRounds,
    pagination,
    isLoading: roundsLoading,
    error: roundsError,
    fetchRounds,
    setFilters,
    clearFilters,
    setPage,
  } = useFederatedRounds();

  const { data: convergenceData, isLoading: convergenceLoading } = useConvergenceData();
  const { budgets, isLoading: budgetsLoading } = usePrivacyBudgets();
  const { metrics: roheMetrics, isLoading: roheLoading } = useROHEMetrics();
  const { createRound, isLoading: createLoading } = useCreateRound();

  const handleRoundClick = (roundId: string) => {
    navigate(`/fleet-learning/rounds/${roundId}`);
  };

  const handleCreateRound = async (data: CreateFederatedRoundRequest) => {
    const round = await createRound(data);
    setShowCreateModal(false);
    navigate(`/fleet-learning/rounds/${round.id}`);
  };

  const handleStatusFilterChange = (status: FederatedRoundStatus | '') => {
    setStatusFilter(status);
    if (status) {
      setFilters({ status });
    } else {
      clearFilters();
    }
  };

  const tabs = [
    { id: 'rounds' as const, label: 'Rounds', icon: Network, count: rounds.length },
    { id: 'convergence' as const, label: 'Convergence', icon: TrendingUp },
    { id: 'privacy' as const, label: 'Privacy', icon: Shield },
    { id: 'rohe' as const, label: 'ROHE', icon: Users },
  ];

  return (
    <div className="container mx-auto px-4 py-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Network className="w-7 h-7 text-primary-600" />
            Fleet Learning
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Federated learning across your robot fleet
          </p>
        </div>

        <div className="flex items-center gap-2">
          {activeRounds.length > 0 && (
            <span className="px-3 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-full text-sm font-medium">
              {activeRounds.length} active
            </span>
          )}
          <button
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
          >
            <Plus size={18} />
            New Round
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 dark:border-gray-700 mb-6">
        <nav className="flex gap-4">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-2 px-4 py-3 border-b-2 font-medium text-sm transition-colors',
                activeTab === tab.id
                  ? 'border-primary-600 text-primary-600 dark:text-primary-400'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              )}
            >
              <tab.icon size={18} />
              {tab.label}
              {tab.count !== undefined && (
                <span className="px-2 py-0.5 bg-gray-100 dark:bg-gray-800 rounded-full text-xs">
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === 'rounds' && (
        <div>
          {/* Filters */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-gray-400" />
                <select
                  value={statusFilter}
                  onChange={(e) => handleStatusFilterChange(e.target.value as FederatedRoundStatus | '')}
                  className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm text-gray-700 dark:text-gray-300"
                >
                  <option value="">All Statuses</option>
                  <option value="created">Created</option>
                  <option value="selecting">Selecting</option>
                  <option value="training">Training</option>
                  <option value="aggregating">Aggregating</option>
                  <option value="completed">Completed</option>
                  <option value="failed">Failed</option>
                </select>
              </div>
            </div>

            <button
              onClick={fetchRounds}
              disabled={roundsLoading}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
            >
              <RefreshCw size={16} className={roundsLoading ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>

          {/* Error */}
          {roundsError && (
            <div className="mb-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-center gap-3 text-red-700 dark:text-red-400">
              <AlertCircle size={20} />
              <span>{roundsError}</span>
            </div>
          )}

          {/* Loading */}
          {roundsLoading && rounds.length === 0 && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
            </div>
          )}

          {/* Empty State */}
          {!roundsLoading && rounds.length === 0 && (
            <div className="text-center py-12">
              <Network className="w-16 h-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
                No Federated Rounds
              </h3>
              <p className="text-gray-500 dark:text-gray-400 mb-4">
                Start your first federated learning round to improve your models with fleet data.
              </p>
              <button
                onClick={() => setShowCreateModal(true)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
              >
                <Plus size={18} />
                Create First Round
              </button>
            </div>
          )}

          {/* Rounds Grid */}
          {rounds.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {rounds.map((round) => (
                <FederatedRoundCard
                  key={round.id}
                  round={round}
                  onClick={() => handleRoundClick(round.id)}
                />
              ))}
            </div>
          )}

          {/* Pagination */}
          {pagination.total > pagination.limit && (
            <div className="flex items-center justify-center gap-2 mt-6">
              <button
                onClick={() => setPage(Math.max(0, pagination.offset - pagination.limit))}
                disabled={pagination.offset === 0}
                className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm disabled:opacity-50"
              >
                Previous
              </button>
              <span className="text-sm text-gray-500 dark:text-gray-400">
                {pagination.offset + 1}-{Math.min(pagination.offset + pagination.limit, pagination.total)} of{' '}
                {pagination.total}
              </span>
              <button
                onClick={() => setPage(pagination.offset + pagination.limit)}
                disabled={pagination.offset + pagination.limit >= pagination.total}
                className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm disabled:opacity-50"
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}

      {activeTab === 'convergence' && (
        <div>
          <ConvergenceChart data={convergenceData} isLoading={convergenceLoading} height={400} />
        </div>
      )}

      {activeTab === 'privacy' && (
        <div>
          <PrivacyBudgetView budgets={budgets} isLoading={budgetsLoading} />
        </div>
      )}

      {activeTab === 'rohe' && (
        <div>
          <ROHEDashboard metrics={roheMetrics} isLoading={roheLoading} />
        </div>
      )}

      {/* Create Modal */}
      <CreateRoundModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSubmit={handleCreateRound}
        isLoading={createLoading}
      />
    </div>
  );
}

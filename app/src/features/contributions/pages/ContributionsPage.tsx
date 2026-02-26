/**
 * @file ContributionsPage.tsx
 * @description Main contributions dashboard page with 4 tabs (TASK-065)
 * @feature Data Contribution
 */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/shared/utils/cn';
import { Database, Upload, Trophy, BarChart3 } from 'lucide-react';
import { ContributionList } from '../components/ContributionList';
import { ContributionBadge } from '../components/ContributionBadge';
import { CreditBalance } from '../components/CreditBalance';
import { LeaderboardTable } from '../components/LeaderboardTable';
import { Leaderboard } from '../components/Leaderboard';
import {
  useContributions,
  useContributionCredits,
  useLeaderboard,
} from '../hooks/contributions';
import { apiClient } from '@/api/client';
import type { DbContributionStatus } from '../components/ContributionBadge';
import type { LeaderboardRow } from '../components/LeaderboardTable';

// ============================================================================
// TYPES
// ============================================================================

type TabId = 'contributions' | 'upload' | 'leaderboard' | 'impact';

interface Tab {
  id: TabId;
  label: string;
  icon: typeof Database;
}

interface DbContribution {
  id: string;
  userId: string;
  robotId: string;
  episodeCount: number;
  frameCount: number;
  sizeBytes: string;
  status: DbContributionStatus;
  creditAwarded: number;
  impactScore: number;
  metadata: string | null;
  createdAt: string;
  updatedAt: string;
}

interface RobotOption {
  id: string;
  name: string;
}

interface ImpactStats {
  totalEpisodes: number;
  totalFrames: number;
  totalSizeBytes: string;
  totalCredits: number;
  contributionCount: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const TABS: Tab[] = [
  { id: 'contributions', label: 'My Contributions', icon: Database },
  { id: 'upload', label: 'Upload', icon: Upload },
  { id: 'leaderboard', label: 'Leaderboard', icon: Trophy },
  { id: 'impact', label: 'Impact', icon: BarChart3 },
];

// ============================================================================
// HELPER
// ============================================================================

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${units[i]}`;
}

// ============================================================================
// COMPONENT
// ============================================================================

export function ContributionsPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabId>('contributions');

  // Existing hooks for in-memory contributions
  const {
    contributions,
    filters,
    pagination,
    isLoading: contributionsLoading,
    setFilters,
    clearFilters,
    setPage,
  } = useContributions();

  useContributionCredits();

  const {
    leaderboard,
    stats,
    isLoading: leaderboardLoading,
  } = useLeaderboard();

  // TASK-065: Prisma-backed state
  const [dbContributions, setDbContributions] = useState<DbContribution[]>([]);
  const [dbLeaderboard, setDbLeaderboard] = useState<LeaderboardRow[]>([]);
  const [impactStats, setImpactStats] = useState<ImpactStats | null>(null);
  const [creditBalance, setCreditBalance] = useState<number>(0);
  const [robots, setRobots] = useState<RobotOption[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);

  // Upload form state
  const [selectedRobot, setSelectedRobot] = useState('');
  const [episodeCount, setEpisodeCount] = useState('');
  const [frameCount, setFrameCount] = useState('');
  const [description, setDescription] = useState('');

  // Fetch Prisma-backed data
  const fetchDbData = useCallback(async () => {
    try {
      const [contribRes, leaderRes, impactRes, creditRes] = await Promise.all([
        apiClient.get<{ contributions: DbContribution[]; total: number }>('/contributions/db'),
        apiClient.get<{ leaderboard: LeaderboardRow[] }>('/contributions/db/leaderboard'),
        apiClient.get<ImpactStats>('/contributions/db/impact'),
        apiClient.get<{ totalCredits: number }>('/contributions/credits/balance'),
      ]);
      setDbContributions(contribRes.data.contributions);
      setDbLeaderboard(leaderRes.data.leaderboard);
      setImpactStats(impactRes.data);
      setCreditBalance(creditRes.data.totalCredits);
    } catch {
      // Silently fail — the Prisma endpoints are additive
    }
  }, []);

  // Fetch robots for dropdown
  useEffect(() => {
    apiClient
      .get<{ robots: RobotOption[] }>('/robots')
      .then((res) => setRobots(res.data.robots || []))
      .catch(() => setRobots([]));
  }, []);

  useEffect(() => {
    fetchDbData();
  }, [fetchDbData]);

  const handleContributionClick = (contribution: { id: string }) => {
    navigate(`/contributions/${contribution.id}`);
  };

  const handleNewContribution = () => {
    navigate('/contributions/new');
  };

  // Upload form submit
  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setSubmitMessage(null);

    try {
      await apiClient.post('/contributions/db', {
        robotId: selectedRobot,
        episodeCount: parseInt(episodeCount, 10),
        frameCount: parseInt(frameCount, 10),
        sizeBytes: 0,
        metadata: description ? { description } : undefined,
      });
      setSubmitMessage('Contribution submitted successfully!');
      setSelectedRobot('');
      setEpisodeCount('');
      setFrameCount('');
      setDescription('');
      fetchDbData();
    } catch {
      setSubmitMessage('Failed to submit contribution. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="container mx-auto px-4 py-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Data Contributions
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Contribute training data and earn credits for rewards
          </p>
        </div>
        <CreditBalance totalCredits={creditBalance} />
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
        {/* Tab 1: My Contributions */}
        {activeTab === 'contributions' && (
          <div className="space-y-6">
            {/* Prisma-backed contributions (TASK-065) */}
            {dbContributions.length > 0 && (
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
                  Recent Uploads
                </h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 dark:border-gray-700 text-left">
                        <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">Status</th>
                        <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">Robot</th>
                        <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 text-right">Episodes</th>
                        <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 text-right">Frames</th>
                        <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 text-right">Size</th>
                        <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 text-right">Credits</th>
                        <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dbContributions.map((c) => (
                        <tr key={c.id} className="border-b border-gray-100 dark:border-gray-800">
                          <td className="px-4 py-3">
                            <ContributionBadge status={c.status} />
                          </td>
                          <td className="px-4 py-3 text-gray-900 dark:text-gray-100 truncate max-w-[150px]">
                            {c.robotId.length > 12 ? `${c.robotId.slice(0, 12)}...` : c.robotId}
                          </td>
                          <td className="px-4 py-3 text-right font-mono">{c.episodeCount}</td>
                          <td className="px-4 py-3 text-right font-mono">{c.frameCount}</td>
                          <td className="px-4 py-3 text-right font-mono">{formatBytes(Number(c.sizeBytes))}</td>
                          <td className="px-4 py-3 text-right font-mono">{c.creditAwarded}</td>
                          <td className="px-4 py-3 text-gray-500 dark:text-gray-400">
                            {new Date(c.createdAt).toLocaleDateString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Original in-memory contributions list */}
            <ContributionList
              contributions={contributions}
              filters={filters}
              pagination={pagination}
              isLoading={contributionsLoading}
              onFilterChange={setFilters}
              onClearFilters={clearFilters}
              onPageChange={setPage}
              onContributionClick={handleContributionClick}
              onNewContribution={handleNewContribution}
            />
          </div>
        )}

        {/* Tab 2: Upload */}
        {activeTab === 'upload' && (
          <div className="max-w-xl mx-auto">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
              Upload Robot Recording
            </h2>
            <form onSubmit={handleUploadSubmit} className="space-y-4">
              {/* Robot Selector */}
              <div>
                <label
                  htmlFor="robot-select"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >
                  Robot
                </label>
                <select
                  id="robot-select"
                  value={selectedRobot}
                  onChange={(e) => setSelectedRobot(e.target.value)}
                  required
                  className={cn(
                    'w-full px-3 py-2 rounded-lg border',
                    'border-gray-300 dark:border-gray-600',
                    'bg-white dark:bg-gray-800',
                    'text-gray-900 dark:text-gray-100',
                    'focus:ring-2 focus:ring-primary-500 focus:border-transparent'
                  )}
                >
                  <option value="">Select a robot...</option>
                  {robots.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name || r.id}
                    </option>
                  ))}
                </select>
              </div>

              {/* Episode Count */}
              <div>
                <label
                  htmlFor="episode-count"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >
                  Episode Count
                </label>
                <input
                  id="episode-count"
                  type="number"
                  min="0"
                  value={episodeCount}
                  onChange={(e) => setEpisodeCount(e.target.value)}
                  required
                  placeholder="e.g. 100"
                  className={cn(
                    'w-full px-3 py-2 rounded-lg border',
                    'border-gray-300 dark:border-gray-600',
                    'bg-white dark:bg-gray-800',
                    'text-gray-900 dark:text-gray-100',
                    'focus:ring-2 focus:ring-primary-500 focus:border-transparent'
                  )}
                />
              </div>

              {/* Frame Count */}
              <div>
                <label
                  htmlFor="frame-count"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >
                  Frame Count
                </label>
                <input
                  id="frame-count"
                  type="number"
                  min="0"
                  value={frameCount}
                  onChange={(e) => setFrameCount(e.target.value)}
                  required
                  placeholder="e.g. 5000"
                  className={cn(
                    'w-full px-3 py-2 rounded-lg border',
                    'border-gray-300 dark:border-gray-600',
                    'bg-white dark:bg-gray-800',
                    'text-gray-900 dark:text-gray-100',
                    'focus:ring-2 focus:ring-primary-500 focus:border-transparent'
                  )}
                />
              </div>

              {/* Description */}
              <div>
                <label
                  htmlFor="description"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >
                  Description
                </label>
                <textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  placeholder="Describe the recorded data..."
                  className={cn(
                    'w-full px-3 py-2 rounded-lg border',
                    'border-gray-300 dark:border-gray-600',
                    'bg-white dark:bg-gray-800',
                    'text-gray-900 dark:text-gray-100',
                    'focus:ring-2 focus:ring-primary-500 focus:border-transparent',
                    'resize-none'
                  )}
                />
              </div>

              {/* Submit */}
              <button
                type="submit"
                disabled={isSubmitting || !selectedRobot || !episodeCount || !frameCount}
                className={cn(
                  'w-full px-4 py-2.5 rounded-lg font-medium text-white',
                  'bg-primary-600 hover:bg-primary-700',
                  'disabled:opacity-50 disabled:cursor-not-allowed',
                  'transition-colors'
                )}
              >
                {isSubmitting ? 'Submitting...' : 'Submit Contribution'}
              </button>

              {submitMessage && (
                <p
                  className={cn(
                    'text-sm text-center',
                    submitMessage.includes('success')
                      ? 'text-green-600 dark:text-green-400'
                      : 'text-red-600 dark:text-red-400'
                  )}
                >
                  {submitMessage}
                </p>
              )}
            </form>
          </div>
        )}

        {/* Tab 3: Leaderboard */}
        {activeTab === 'leaderboard' && (
          <div className="space-y-6">
            {/* Prisma-backed leaderboard table (TASK-065) */}
            {dbLeaderboard.length > 0 && (
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
                  Top Contributors (Database)
                </h2>
                <LeaderboardTable entries={dbLeaderboard} />
              </div>
            )}

            {/* Original in-memory leaderboard */}
            <Leaderboard
              entries={leaderboard}
              currentUserStats={stats}
              isLoading={leaderboardLoading}
            />
          </div>
        )}

        {/* Tab 4: Impact */}
        {activeTab === 'impact' && (
          <div className="space-y-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
              My Impact
            </h2>

            {impactStats ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="p-4 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                  <p className="text-sm text-gray-500 dark:text-gray-400">Total Episodes</p>
                  <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                    {impactStats.totalEpisodes.toLocaleString()}
                  </p>
                </div>
                <div className="p-4 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                  <p className="text-sm text-gray-500 dark:text-gray-400">Total Frames</p>
                  <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                    {impactStats.totalFrames.toLocaleString()}
                  </p>
                </div>
                <div className="p-4 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                  <p className="text-sm text-gray-500 dark:text-gray-400">Total Size</p>
                  <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                    {formatBytes(Number(impactStats.totalSizeBytes))}
                  </p>
                </div>
                <div className="p-4 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                  <p className="text-sm text-gray-500 dark:text-gray-400">Credits Earned</p>
                  <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">
                    {impactStats.totalCredits.toLocaleString()}
                  </p>
                </div>
                <div className="p-4 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                  <p className="text-sm text-gray-500 dark:text-gray-400">Contributions</p>
                  <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                    {impactStats.contributionCount}
                  </p>
                </div>
                <div className="p-4 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                  <p className="text-sm text-gray-500 dark:text-gray-400">Impact Score</p>
                  <p className="text-2xl font-bold text-primary-600 dark:text-primary-400">
                    {impactStats.totalEpisodes > 0
                      ? (impactStats.totalCredits / impactStats.totalEpisodes).toFixed(2)
                      : '0'}
                  </p>
                </div>
              </div>
            ) : (
              <div className="text-center py-12 text-gray-500 dark:text-gray-400">
                <BarChart3 className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p className="text-lg">No impact data yet</p>
                <p className="text-sm mt-1">Start contributing data to see your impact!</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

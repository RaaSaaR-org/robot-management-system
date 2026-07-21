/**
 * @file DataCollectionPage.tsx
 * @description Main data collection page with sessions, priorities, and uncertainty tabs
 * @feature datacollection
 */

import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Video,
  Target,
  BarChart3,
  Database,
  Plus,
  ChevronDown,
  ChevronRight,
  GraduationCap,
  Gamepad2,
} from 'lucide-react';
import { Tabs } from '@/shared/components/ui/Tabs';
import { PageHeader } from '@/shared/components/ui/PageHeader';
import { Card } from '@/shared/components/ui/Card';
import { PipelineBreadcrumb } from '@/shared/components/ui/PipelineBreadcrumb';
import { NextStepBanner } from '@/shared/components/ui/NextStepBanner';
import { SessionList } from '../components/SessionList';
import { PriorityDashboard } from '../components/PriorityDashboard';
import { UncertaintyHeatmap } from '../components/UncertaintyHeatmap';
import {
  useTeleoperationSessions,
  useCollectionPriorities,
} from '../hooks/datacollection';
import type { RegisteredModel } from '@/features/training/types';

// ============================================================================
// EDUCATIONAL BANNER
// ============================================================================

function EducationBanner() {
  const [expanded, setExpanded] = useState(false);
  return (
    <Card variant="subtle" className="border border-cobalt-500/20">
      <button
        type="button"
        onClick={() => setExpanded((x) => !x)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div className="flex items-center gap-3">
          <div className="p-1.5 rounded-brand bg-cobalt-500/10">
            <GraduationCap className="w-4 h-4 text-cobalt-400" />
          </div>
          <div>
            <div className="text-sm font-semibold text-theme-primary">
              How teleoperation data collection works
            </div>
            <div className="text-xs text-theme-muted">
              {expanded ? 'Click to collapse' : 'New here? Click to learn the basics'}
            </div>
          </div>
        </div>
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-theme-muted" />
        ) : (
          <ChevronRight className="w-4 h-4 text-theme-muted" />
        )}
      </button>

      {expanded && (
        <div className="px-4 pb-4 pt-1 space-y-3 text-sm text-theme-secondary leading-relaxed border-t border-glass-subtle">
          <p className="pt-3">
            <strong className="text-theme-primary">What this page does:</strong>{' '}
            Lets you record <strong>teleoperation demonstrations</strong> — a human
            controls the robot while frames, joint states, and actions are captured in
            LeRobot v3 format. These sessions become training datasets for VLA models.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
            <div className="p-3 rounded-brand bg-glass-bg border border-glass-subtle">
              <div className="font-semibold text-theme-primary mb-1 flex items-center gap-1.5">
                <Gamepad2 className="w-3.5 h-3.5 text-cobalt-400" /> 1. Choose input
              </div>
              <p className="text-theme-muted">
                Select your teleoperation method: VR headset, bilateral ALOHA,
                kinesthetic teaching, keyboard, or gamepad.
              </p>
            </div>
            <div className="p-3 rounded-brand bg-glass-bg border border-glass-subtle">
              <div className="font-semibold text-theme-primary mb-1 flex items-center gap-1.5">
                <Video className="w-3.5 h-3.5 text-turquoise-400" /> 2. Record
              </div>
              <p className="text-theme-muted">
                Demonstrate the task while the system records camera frames, joint
                positions, and actions at your chosen FPS.
              </p>
            </div>
            <div className="p-3 rounded-brand bg-glass-bg border border-glass-subtle">
              <div className="font-semibold text-theme-primary mb-1 flex items-center gap-1.5">
                <Database className="w-3.5 h-3.5 text-cobalt-400" /> 3. Export
              </div>
              <p className="text-theme-muted">
                Completed sessions can be exported as datasets and used to train or
                fine-tune VLA models like SmolVLA or pi0.5.
              </p>
            </div>
          </div>
          <div className="text-xs text-theme-muted pt-1">
            <strong className="text-theme-secondary">Hover over any &#9432; icon</strong> on
            this page to learn what a specific field or metric means.
          </div>
        </div>
      )}
    </Card>
  );
}

// ============================================================================
// COMPONENT
// ============================================================================

export function DataCollectionPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('sessions');

  // Model selector state for priorities + uncertainty.
  // TASK-142: MLflow registry deleted; selection is no longer available.
  // Active-learning panels still render with an empty model list.
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const models: RegisteredModel[] = [];
  const modelsLoading = false;

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
  } = useCollectionPriorities(selectedModelId ?? undefined);

  const handleSessionClick = useCallback(
    (session: { id: string }) => {
      navigate(`/data-collection/${session.id}`);
    },
    [navigate]
  );

  const handleNewSession = useCallback(() => {
    navigate('/data-collection/new');
  }, [navigate]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        title="Data Collection"
        subtitle="Record teleoperation demos and manage collection priorities"
        actions={
          <>
            <button
              onClick={handleNewSession}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-brand text-sm font-medium bg-cobalt-500/15 text-cobalt-400 hover:bg-cobalt-500/25 border border-cobalt-500/20 transition-all whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              New Session
            </button>
            <PipelineBreadcrumb stage="collect" />
          </>
        }
      />

      {/* Educational banner (collapsed by default) */}
      <EducationBanner />

      {/* Tabs */}
      <Tabs
        activeTab={activeTab}
        onTabChange={setActiveTab}
        tabs={[
          {
            id: 'sessions',
            label: 'Sessions',
            icon: <Video className="w-4 h-4" />,
            content: (
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
            ),
          },
          {
            id: 'priorities',
            label: 'Collection Priorities',
            icon: <Target className="w-4 h-4" />,
            content: (
              <PriorityDashboard
                priorities={priorities}
                isLoading={prioritiesLoading}
                models={models}
                selectedModelId={selectedModelId}
                onModelChange={setSelectedModelId}
                modelsLoading={modelsLoading}
              />
            ),
          },
          {
            id: 'uncertainty',
            label: 'Uncertainty Analysis',
            icon: <BarChart3 className="w-4 h-4" />,
            content: (
              <UncertaintyHeatmap
                models={models}
                selectedModelId={selectedModelId}
                onModelChange={setSelectedModelId}
                modelsLoading={modelsLoading}
              />
            ),
          },
        ]}
      />

      {/* Next step banner */}
      <NextStepBanner
        title="Done collecting demos?"
        description="Export sessions as datasets, then train a VLA model with your data."
        ctaLabel="Go to Training"
        ctaHref="/training"
        icon={<Database className="w-5 h-5" />}
      />
    </div>
  );
}

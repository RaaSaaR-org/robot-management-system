/**
 * @file NewSessionPage.tsx
 * @description Page for creating a new teleoperation session
 * @feature datacollection
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, AlertCircle, Bot, Play, Headset } from 'lucide-react';
import { Card } from '@/shared/components/ui/Card';
import { InfoIcon } from '@/shared/components/ui/Tooltip';
import { SessionTypeSelector } from '../components/SessionTypeSelector';
import { useDataCollectionStore } from '../store/datacollectionStore';
import { useRobotsStore } from '../../robots/store/robotsStore';
import type { TeleoperationType, CreateSessionRequest } from '../types/datacollection.types';

// ============================================================================
// COMPONENT
// ============================================================================

export function NewSessionPage() {
  const navigate = useNavigate();

  // Store
  const createSession = useDataCollectionStore((state) => state.createSession);
  const setActiveSession = useDataCollectionStore((state) => state.setActiveSession);
  const isLoading = useDataCollectionStore((state) => state.isLoading);
  const error = useDataCollectionStore((state) => state.error);
  const clearError = useDataCollectionStore((state) => state.clearError);

  // Clear stale error state on mount
  useEffect(() => {
    clearError();
  }, [clearError]);

  // Robots
  const robots = useRobotsStore((state) => state.robots);
  const fetchRobots = useRobotsStore((state) => state.fetchRobots);

  useEffect(() => {
    fetchRobots();
  }, [fetchRobots]);

  // Form state
  const [formData, setFormData] = useState<Partial<CreateSessionRequest>>({
    operatorId: 'current-user', // TODO: Get from auth
    fps: 10,
    numEpisodes: 3,
  });
  const [formError, setFormError] = useState<string | null>(null);

  const isVrType = formData.type === 'vr_quest' || formData.type === 'vr_vision_pro';

  const handleTypeChange = (type: TeleoperationType) => {
    setFormData((prev) => ({ ...prev, type }));
    setFormError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate
    if (!formData.type) {
      setFormError('Please select a teleoperation type');
      return;
    }
    if (!formData.robotId) {
      setFormError('Please enter a robot ID');
      return;
    }

    try {
      const session = await createSession(formData as CreateSessionRequest);
      setActiveSession(session);
      navigate(`/data-collection/${session.id}`);
    } catch {
      // Error handled by store
    }
  };

  const handleBack = () => {
    navigate('/data-collection');
  };

  const displayError = error || formError;

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button
          onClick={handleBack}
          className="p-2 hover:bg-glass-subtle rounded-brand transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-theme-muted" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-theme-primary">
            New Session
          </h1>
          <p className="text-sm text-theme-muted">
            Create a new teleoperation data collection session
          </p>
        </div>
      </div>

      {/* Error Display */}
      {displayError && (
        <Card variant="subtle" className="!bg-red-500/10 border border-red-500/20">
          <div className="flex items-center gap-3 px-4 py-3 text-red-400 text-sm">
            <AlertCircle size={18} className="shrink-0" />
            <span>{displayError}</span>
          </div>
        </Card>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit}>
        <Card>
          <div className="space-y-6">
            {/* Teleoperation Type */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <label className="text-sm font-medium text-theme-secondary">
                  Teleoperation Type *
                </label>
                <InfoIcon
                  content="Choose how the operator will control the robot during recording. Each method captures different input modalities."
                  side="right"
                />
              </div>
              <SessionTypeSelector
                value={formData.type}
                onChange={handleTypeChange}
                disabled={isLoading}
              />
            </div>

            {/* VR prerequisites */}
            {isVrType && (
              <div
                className="rounded-brand border border-cobalt-500/20 bg-cobalt-500/5 p-4"
                data-testid="vr-prerequisites"
              >
                <div className="flex items-center gap-2 mb-2">
                  <Headset className="w-4 h-4 text-cobalt-400" />
                  <h3 className="text-sm font-semibold text-theme-primary">
                    VR session prerequisites
                  </h3>
                </div>
                <ol className="list-decimal list-inside space-y-1 text-sm text-theme-secondary">
                  <li>Put the headset on the same network as this app.</li>
                  <li>Open this app's URL in the headset browser and navigate to the session.</li>
                  <li>
                    Launch VR from the session page and press{' '}
                    <span className="font-medium text-theme-primary">Enter VR</span> — grip a
                    controller to move that arm.
                  </li>
                </ol>
                <p className="mt-2 text-xs text-theme-muted">
                  No headset handy? The session page offers a{' '}
                  <span className="font-medium">"Simulate VR input"</span> toggle that streams
                  synthetic motion so you can test the recording pipeline end-to-end.
                </p>
              </div>
            )}

            {/* Robot Selection (dropdown) */}
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <label className="text-sm font-medium text-theme-secondary">
                  Robot *
                </label>
                <InfoIcon
                  content="The robot must be online and available for teleoperation."
                  side="right"
                />
              </div>
              <div className="relative">
                <Bot className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-theme-muted" />
                <select
                  value={formData.robotId || ''}
                  onChange={(e) => {
                    setFormData((prev) => ({ ...prev, robotId: e.target.value }));
                    setFormError(null);
                  }}
                  disabled={isLoading}
                  className="w-full pl-10 pr-4 py-2.5 rounded-brand border border-theme bg-theme-card text-theme-primary disabled:opacity-50 disabled:cursor-not-allowed appearance-none focus:outline-none focus:ring-2 focus:ring-cobalt-500 focus:border-transparent"
                >
                  <option value="">Select a robot...</option>
                  {robots.map((robot) => (
                    <option key={robot.id} value={robot.id}>
                      {robot.name} ({robot.model}) — {robot.status}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* FPS */}
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <label className="text-sm font-medium text-theme-secondary">
                  Recording FPS
                </label>
                <InfoIcon
                  content="Frames per second for recording. Higher FPS captures smoother motion but generates larger datasets. 10 FPS is standard for most tasks."
                  side="right"
                />
              </div>
              <input
                type="number"
                min="1"
                max="120"
                value={formData.fps || 10}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, fps: parseInt(e.target.value, 10) || 10 }))
                }
                disabled={isLoading}
                className="w-32 rounded-brand border border-theme bg-theme-card px-3 py-2.5 text-theme-primary placeholder:text-theme-tertiary focus:outline-none focus:ring-2 focus:ring-cobalt-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
              />
              <p className="mt-1.5 text-sm text-theme-tertiary">
                Default: 10 FPS
              </p>
            </div>

            {/* Language Instruction */}
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <label className="text-sm font-medium text-theme-secondary">
                  Task Description *
                </label>
                <InfoIcon
                  content="Natural language description of the task being demonstrated. This becomes the language instruction for VLA training. Can be added or changed later."
                  side="right"
                />
              </div>
              <textarea
                value={formData.languageInstr || ''}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, languageInstr: e.target.value }))
                }
                rows={2}
                placeholder="Pick up the red block and place it on the plate"
                disabled={isLoading}
                className="w-full rounded-brand border border-theme bg-theme-card px-3 py-2.5 text-theme-primary placeholder:text-theme-tertiary focus:outline-none focus:ring-2 focus:ring-cobalt-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
              />
            </div>

            {/* Episode Settings */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <label className="text-sm font-medium text-theme-secondary">
                    Episodes
                  </label>
                  <InfoIcon
                    content="Number of demonstration episodes to record in this session."
                    side="right"
                  />
                </div>
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={formData.numEpisodes ?? 3}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, numEpisodes: parseInt(e.target.value, 10) || 3 }))
                  }
                  disabled={isLoading}
                  className="w-full rounded-brand border border-theme bg-theme-card px-3 py-2.5 text-theme-primary placeholder:text-theme-tertiary focus:outline-none focus:ring-2 focus:ring-cobalt-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
                />
                <p className="mt-1.5 text-sm text-theme-tertiary">
                  Number of demonstration episodes
                </p>
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <label className="text-sm font-medium text-theme-secondary">
                    Episode Duration (s)
                  </label>
                  <InfoIcon
                    content="Maximum seconds per episode. Recording stops automatically after this time."
                    side="right"
                  />
                </div>
                <input
                  type="number"
                  min="5"
                  max="300"
                  value={(formData as Record<string, unknown>).episodeTimeS as number || 30}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, episodeTimeS: parseInt(e.target.value, 10) || 30 }))
                  }
                  disabled={isLoading}
                  className="w-full rounded-brand border border-theme bg-theme-card px-3 py-2.5 text-theme-primary placeholder:text-theme-tertiary focus:outline-none focus:ring-2 focus:ring-cobalt-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
                />
                <p className="mt-1.5 text-sm text-theme-tertiary">
                  Max seconds per episode
                </p>
              </div>
            </div>
          </div>
        </Card>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 mt-6">
          <button
            type="button"
            onClick={handleBack}
            disabled={isLoading}
            className="px-4 py-2 text-theme-secondary hover:text-theme-primary disabled:opacity-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isLoading}
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-brand text-sm font-medium bg-cobalt-500/15 text-cobalt-400 hover:bg-cobalt-500/25 border border-cobalt-500/20 transition-all disabled:opacity-50"
          >
            {isLoading ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <Play size={18} />
                Create Session
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

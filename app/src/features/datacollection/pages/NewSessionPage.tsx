/**
 * @file NewSessionPage.tsx
 * @description Page for creating a new teleoperation session
 * @feature datacollection
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, AlertCircle, Bot, Play } from 'lucide-react';
import { SessionTypeSelector } from '../components/SessionTypeSelector';
import { useDataCollectionStore } from '../store/datacollectionStore';
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

  // Form state
  const [formData, setFormData] = useState<Partial<CreateSessionRequest>>({
    operatorId: 'current-user', // TODO: Get from auth
    fps: 30,
  });
  const [formError, setFormError] = useState<string | null>(null);

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
      navigate(`/data-collection/sessions/${session.id}`);
    } catch (err) {
      // Error handled by store
    }
  };

  const handleBack = () => {
    navigate('/data-collection');
  };

  const displayError = error || formError;

  return (
    <div className="container mx-auto px-4 py-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={handleBack}
          className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
        >
          <ArrowLeft className="w-5 h-5 text-gray-500" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            New Session
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Create a new teleoperation data collection session
          </p>
        </div>
      </div>

      {/* Error Display */}
      {displayError && (
        <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-center gap-3 text-red-700 dark:text-red-400">
          <AlertCircle size={20} />
          <span>{displayError}</span>
        </div>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit}>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 space-y-6">
          {/* Teleoperation Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
              Teleoperation Type *
            </label>
            <SessionTypeSelector
              value={formData.type}
              onChange={handleTypeChange}
              disabled={isLoading}
            />
          </div>

          {/* Robot Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Robot ID *
            </label>
            <div className="relative">
              <Bot className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                value={formData.robotId || ''}
                onChange={(e) => {
                  setFormData((prev) => ({ ...prev, robotId: e.target.value }));
                  setFormError(null);
                }}
                placeholder="Enter robot ID"
                disabled={isLoading}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 disabled:opacity-50"
              />
            </div>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              The robot must be online and available for teleoperation
            </p>
          </div>

          {/* FPS */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Recording FPS
            </label>
            <input
              type="number"
              min="1"
              max="120"
              value={formData.fps || 30}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, fps: parseInt(e.target.value, 10) || 30 }))
              }
              disabled={isLoading}
              className="w-32 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 disabled:opacity-50"
            />
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Frames per second for recording (default: 30)
            </p>
          </div>

          {/* Language Instruction */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Task Description (optional)
            </label>
            <textarea
              value={formData.languageInstr || ''}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, languageInstr: e.target.value }))
              }
              rows={3}
              placeholder="Describe the task being demonstrated..."
              disabled={isLoading}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 disabled:opacity-50"
            />
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Natural language description of the task (can be added later)
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 mt-6">
          <button
            type="button"
            onClick={handleBack}
            disabled={isLoading}
            className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isLoading}
            className="inline-flex items-center gap-2 px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
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

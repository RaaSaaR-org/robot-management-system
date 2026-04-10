/**
 * @file RunSkillModal.tsx
 * @description Modal for executing a skill on a selected robot. Calls
 * POST /api/skills/:id/execute via the deploymentApi. Added by TASK-143
 * to give users a one-click "Run on robot" surface from the Skill Library.
 * @feature deployment
 */

import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal, Button, Badge, Card } from '@/shared/components/ui';
import { useRobots } from '@/features/robots/hooks/useRobots';
import { deploymentApi } from '../api/deploymentApi';
import type { SkillDefinition, SkillExecutionResult } from '../types';

export interface RunSkillModalProps {
  isOpen: boolean;
  onClose: () => void;
  skill: SkillDefinition | null;
}

export function RunSkillModal({ isOpen, onClose, skill }: RunSkillModalProps) {
  const navigate = useNavigate();
  const { robots, fetchRobots } = useRobots();
  const [robotId, setRobotId] = useState<string>('');
  const [parametersJson, setParametersJson] = useState<string>('{}');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SkillExecutionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      void fetchRobots();
      setResult(null);
      setError(null);
    }
  }, [isOpen, fetchRobots]);

  // Compatible robots: must be online and have all required capabilities
  const compatibleRobots = useMemo(() => {
    if (!skill) return [];
    return robots.filter((r) => {
      if (r.status !== 'online') return false;
      const reqs = skill.requiredCapabilities ?? [];
      return reqs.every((c) => r.capabilities?.includes(c));
    });
  }, [robots, skill]);

  // Pre-select the first compatible robot when the modal opens
  useEffect(() => {
    if (isOpen && compatibleRobots.length > 0 && !robotId) {
      setRobotId(compatibleRobots[0].id);
    }
  }, [isOpen, compatibleRobots, robotId]);

  // Reset robot selection when modal closes
  useEffect(() => {
    if (!isOpen) {
      setRobotId('');
      setParametersJson('{}');
    }
  }, [isOpen]);

  if (!skill) return null;

  const handleRun = async () => {
    setError(null);
    setResult(null);

    if (!robotId) {
      setError('Pick a robot first.');
      return;
    }

    let parameters: Record<string, unknown> = {};
    if (parametersJson.trim()) {
      try {
        parameters = JSON.parse(parametersJson);
      } catch {
        setError('Parameters must be valid JSON.');
        return;
      }
    }

    // TASK-146: navigate to the robot detail page in "executing" mode BEFORE
    // dispatching the call. The closed-loop request can take 30+ seconds and
    // the live execution panel is the place users want to be while it runs.
    navigate(`/robots/${robotId}?executing=${encodeURIComponent(skill.id)}`);
    onClose();

    // Fire-and-forget the execute call. The robot detail page subscribes to
    // skill events via the WebSocket and will reflect status updates there.
    setRunning(true);
    try {
      const r = await deploymentApi.executeSkill(skill.id, { robotId, parameters });
      setResult(r);
      if (r.status !== 'completed') {
        setError(r.error ?? `Execution ${r.status}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to execute skill';
      setError(message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Run "${skill.name}" on a robot`}
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={running}>
            Close
          </Button>
          <Button variant="primary" onClick={handleRun} disabled={running || !robotId}>
            {running ? 'Running…' : 'Run now'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <p className="text-xs font-medium text-theme-secondary mb-1">Skill</p>
          <p className="text-sm text-theme-primary">
            {skill.name} <span className="text-theme-tertiary">v{skill.version}</span>
          </p>
          {skill.requiredCapabilities && skill.requiredCapabilities.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {skill.requiredCapabilities.map((cap) => (
                <Badge key={cap} variant="default" size="sm">
                  {cap}
                </Badge>
              ))}
            </div>
          )}
        </div>

        <div>
          <label className="block text-xs font-medium text-theme-secondary mb-1">
            Robot
          </label>
          {compatibleRobots.length === 0 ? (
            <Card className="p-3 text-sm text-theme-secondary">
              No compatible online robots. The skill requires{' '}
              {skill.requiredCapabilities?.join(', ') || 'no capabilities'}.
            </Card>
          ) : (
            <select
              value={robotId}
              onChange={(e) => setRobotId(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-theme-primary"
            >
              {compatibleRobots.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.id}) — {r.location?.zone ?? 'unknown zone'}
                </option>
              ))}
            </select>
          )}
        </div>

        <div>
          <label className="block text-xs font-medium text-theme-secondary mb-1">
            Parameters (JSON)
          </label>
          <textarea
            value={parametersJson}
            onChange={(e) => setParametersJson(e.target.value)}
            rows={4}
            className="w-full px-3 py-2 text-sm font-mono rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-theme-primary"
            placeholder='{"target": "block_a"}'
          />
        </div>

        {error && (
          <Card className="p-3 bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          </Card>
        )}

        {result && result.status === 'completed' && (
          <Card className="p-3 bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800">
            <p className="text-sm text-green-700 dark:text-green-400">
              Skill executed successfully ({result.duration ?? 0}ms).
            </p>
          </Card>
        )}
      </div>
    </Modal>
  );
}

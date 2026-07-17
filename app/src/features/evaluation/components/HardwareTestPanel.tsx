/**
 * @file HardwareTestPanel.tsx
 * @description Inline hardware evaluation runner — picks a robot + skill and
 * triggers POST /api/evaluation/run-hardware. Per-episode rows persist via
 * the agent → server pipeline; the summary is shown inline. (TASK-146 Phase C)
 * @feature evaluation
 */

import { useEffect, useState } from 'react';
import { Play } from 'lucide-react';
import { Button, Card } from '@/shared/components/ui';
import { useRobots } from '@/features/robots/hooks/useRobots';
import { deploymentApi } from '@/features/deployment/api/deploymentApi';
import { evaluationApi, type HardwareEvaluationSummary } from '../api/evaluationApi';
import type { SkillDefinition } from '@/features/deployment/types';

export interface HardwareTestPanelProps {
  /** Called after a run completes so the parent can refresh charts. */
  onComplete?: () => void;
}

export function HardwareTestPanel({ onComplete }: HardwareTestPanelProps) {
  const { robots, fetchRobots } = useRobots();
  const [skills, setSkills] = useState<SkillDefinition[]>([]);
  const [skillId, setSkillId] = useState<string>('');
  const [robotId, setRobotId] = useState<string>('');
  const [episodes, setEpisodes] = useState<number>(3);
  const [taskPrompt, setTaskPrompt] = useState<string>('');
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState<HardwareEvaluationSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchRobots();
    void deploymentApi.listSkills({ pageSize: 100 }).then((res) => setSkills(res.skills));
  }, [fetchRobots]);

  // Default the prompt to the skill's name once selected.
  useEffect(() => {
    const skill = skills.find((s) => s.id === skillId);
    if (skill && !taskPrompt) {
      setTaskPrompt(`Execute skill ${skill.name}`);
    }
  }, [skillId, skills, taskPrompt]);

  const onlineRobots = robots.filter((r) => r.status === 'online');

  const handleRun = async () => {
    setRunning(true);
    setError(null);
    setSummary(null);
    try {
      const result = await evaluationApi.runHardwareEvaluation({
        robotId,
        skillId,
        episodes,
        taskPrompt,
      });
      setSummary(result);
      onComplete?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Hardware evaluation failed';
      setError(message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card className="border-theme section-primary">
      <div className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-theme-primary">Hardware Test</h2>
            <p className="text-xs text-theme-secondary mt-1">
              Run N closed-loop episodes against a real robot. Results land in the table above.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-medium text-theme-secondary mb-1">Skill</label>
            <select
              value={skillId}
              onChange={(e) => setSkillId(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-brand border border-theme bg-theme-card text-theme-primary focus:outline-none focus:ring-2 focus:ring-cobalt-500 focus:border-transparent"
            >
              <option value="">Pick a skill…</option>
              {skills.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} v{s.version}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-theme-secondary mb-1">Robot</label>
            <select
              value={robotId}
              onChange={(e) => setRobotId(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-brand border border-theme bg-theme-card text-theme-primary focus:outline-none focus:ring-2 focus:ring-cobalt-500 focus:border-transparent"
            >
              <option value="">Pick a robot…</option>
              {onlineRobots.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.id})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-theme-secondary mb-1">Episodes</label>
            <input
              type="number"
              min={1}
              max={50}
              value={episodes}
              onChange={(e) => setEpisodes(parseInt(e.target.value, 10) || 1)}
              className="w-full px-3 py-2 text-sm rounded-brand border border-theme bg-theme-card text-theme-primary focus:outline-none focus:ring-2 focus:ring-cobalt-500 focus:border-transparent"
            />
          </div>

          <div className="flex items-end">
            <Button
              variant="primary"
              onClick={handleRun}
              disabled={running || !skillId || !robotId}
              className="w-full"
            >
              <Play className="w-4 h-4 mr-1.5 inline-block" />
              {running ? 'Running…' : 'Start hardware evaluation'}
            </Button>
          </div>
        </div>

        <div className="mt-3">
          <label className="block text-xs font-medium text-theme-secondary mb-1">Task prompt</label>
          <input
            type="text"
            value={taskPrompt}
            onChange={(e) => setTaskPrompt(e.target.value)}
            placeholder="Pick up the red cube and place it in the box."
            className="w-full px-3 py-2 text-sm rounded-brand border border-theme bg-theme-card text-theme-primary focus:outline-none focus:ring-2 focus:ring-cobalt-500 focus:border-transparent"
          />
        </div>

        {error && (
          <div className="mt-3 p-3 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
            {error}
          </div>
        )}

        {summary && (
          <div className="mt-3 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-md">
            <p className="text-sm font-medium text-green-700 dark:text-green-400">
              {summary.successCount} / {summary.episodes} succeeded ({(summary.successRate * 100).toFixed(0)}%)
            </p>
            <ul className="mt-2 space-y-1 text-xs text-theme-secondary">
              {summary.results.map((r) => (
                <li key={r.index}>
                  Episode {r.index + 1}: <span className="font-mono">{r.status}</span> — {r.steps} steps,{' '}
                  {(r.durationMs / 1000).toFixed(1)}s
                  {r.error ? ` — ${r.error}` : ''}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}

/**
 * @file HardwareTestPanel.tsx
 * @description Run hardware test: pick a skill and an online robot, confirm, run N closed-loop episodes;
 *              the last result is shown in a panel. (TASK-146 Phase C)
 * @feature evaluation
 */

import { useEffect, useState } from 'react';
import { Cpu, Play } from 'lucide-react';
import {
  Button,
  EmptyState,
  FormField,
  FormModal,
  Input,
  Panel,
  Select,
  StatusTag,
  confirm,
  toast,
} from '@/shared/components/ui';
import { getErrorMessage } from '@/shared/utils';
import { useRobots } from '@/features/robots/hooks/useRobots';
import { deploymentApi } from '@/features/deployment/api/deploymentApi';
import type { SkillDefinition } from '@/features/deployment/types';
import { evaluationApi, type HardwareEvaluationSummary } from '../api/evaluationApi';

export interface HardwareTestPanelProps {
  /** Called after a run completes so the parent can refresh its charts. */
  onComplete?: () => void;
  /** Controlled "Run hardware test" modal (the page header owns the button). */
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function HardwareTestPanel({ onComplete, isOpen, onOpenChange }: HardwareTestPanelProps) {
  const { robots, fetchRobots } = useRobots();
  const [skills, setSkills] = useState<SkillDefinition[]>([]);
  const [localOpen, setLocalOpen] = useState(false);
  const open = isOpen ?? localOpen;
  const setOpen = onOpenChange ?? setLocalOpen;
  const [skillId, setSkillId] = useState('');
  const [robotId, setRobotId] = useState('');
  const [episodes, setEpisodes] = useState('3');
  const [taskPrompt, setTaskPrompt] = useState('');
  const [errors, setErrors] = useState<{ skill?: string; robot?: string; episodes?: string }>({});
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState<HardwareEvaluationSummary | null>(null);

  useEffect(() => {
    void fetchRobots();
    deploymentApi.listSkills({ pageSize: 100 }).then((res) => setSkills(res.skills)).catch(() => setSkills([]));
  }, [fetchRobots]);

  // Default the prompt to the skill's name once one is chosen.
  useEffect(() => {
    const skill = skills.find((s) => s.id === skillId);
    if (skill && !taskPrompt) setTaskPrompt(`Execute skill ${skill.name}`);
  }, [skillId, skills, taskPrompt]);

  const online = robots.filter((r) => r.status === 'online');
  const skill = skills.find((s) => s.id === skillId);
  const robot = online.find((r) => r.id === robotId);
  const count = Number(episodes);

  const submit = async () => {
    const next: typeof errors = {};
    if (!skill) next.skill = 'Choose a skill.';
    if (!robot) next.robot = 'Choose an online robot.';
    if (!Number.isInteger(count) || count < 1 || count > 50) next.episodes = 'Between 1 and 50.';
    setErrors(next);
    if (!skill || !robot || Object.keys(next).length > 0) return;
    const ok = await confirm({
      title: `Run ${skill.name} on ${robot.name}?`,
      description: `${robot.name} will move and run ${count} closed-loop ${count === 1 ? 'episode' : 'episodes'}. Keep its workspace clear.`,
      confirmLabel: 'Run test',
    });
    if (!ok) return;
    setRunning(true);
    try {
      const result = await evaluationApi.runHardwareEvaluation({ robotId, skillId, episodes: count, taskPrompt });
      setSummary(result);
      setOpen(false);
      toast.success('Hardware test finished', {
        description: `${result.successCount} of ${result.episodes} episodes succeeded on ${robot.name}.`,
      });
      onComplete?.();
    } catch (err) {
      toast.error("Couldn't run the hardware test", { description: getErrorMessage(err, 'The robot did not answer') });
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <Panel>
        <Panel.Header
          title="Hardware tests"
          description="Closed-loop episodes on a real robot. Results feed the charts above."
          actions={
            // The /training header owns "Run hardware test"; standalone, the panel offers it.
            isOpen === undefined ? (
              <Button variant="secondary" size="sm" leftIcon={<Play className="h-4 w-4" />} onClick={() => setOpen(true)}>Run hardware test</Button>
            ) : undefined
          }
        />
        <Panel.Body>
          {summary ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2 text-sm text-ink-primary">
                <StatusTag tone={summary.successRate >= 0.8 ? 'success' : summary.successRate >= 0.5 ? 'warning' : 'danger'}>
                  {`${(summary.successRate * 100).toFixed(0)}%`}
                </StatusTag>
                {summary.successCount} of {summary.episodes} episodes succeeded
              </div>
              <ul className="flex flex-col gap-1 text-[13px] text-ink-secondary">
                {summary.results.map((r) => (
                  <li key={r.index}>
                    Episode {r.index + 1}: {r.status}, {r.steps} steps, {(r.durationMs / 1000).toFixed(1)} s{r.error ? ` (${r.error})` : ''}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-ink-tertiary">No test run in this session yet.</p>
          )}
        </Panel.Body>
      </Panel>

      <FormModal
        isOpen={open}
        onClose={() => setOpen(false)}
        title="Run hardware test"
        description="Runs the deployed model on a real robot and records each episode."
        submitLabel="Run test"
        submittingLabel="Running…"
        isSubmitting={running}
        submitDisabled={online.length === 0}
        onSubmit={submit}
        noValidate
      >
        {online.length === 0 ? (
          <EmptyState
            size="sm"
            icon={<Cpu />}
            title="No robot is online"
            description="Start a robot agent, then come back. Offline robots cannot run a test."
          />
        ) : (
          <>
            <FormField label="Skill" required error={errors.skill}>
              <Select placeholder="Choose a skill…" value={skillId} onChange={(e) => setSkillId(e.target.value)} options={skills.map((s) => ({ value: s.id, label: `${s.name} v${s.version}` }))} />
            </FormField>
            <FormField label="Robot" required error={errors.robot}>
              <Select placeholder="Choose a robot…" value={robotId} onChange={(e) => setRobotId(e.target.value)} options={online.map((r) => ({ value: r.id, label: r.name }))} />
            </FormField>
            <FormField label="Episodes" error={errors.episodes}>
              <Input type="number" min={1} max={50} value={episodes} onChange={(e) => setEpisodes(e.target.value)} />
            </FormField>
            <FormField label="Task prompt" aside="Optional">
              <Input value={taskPrompt} onChange={(e) => setTaskPrompt(e.target.value)} placeholder="Pick up the red cube and place it in the box." />
            </FormField>
          </>
        )}
      </FormModal>
    </>
  );
}

/**
 * @file AutonomousExecutionPanel.tsx
 * @description Live execution panel shown on the robot detail page while a skill
 * runs on this robot. Reads `?executing=<skillId>` from the URL, shows elapsed
 * time and status, and lets the operator stop the skill. Added by TASK-146 —
 * pairs with `RunSkillModal`, which navigates here after dispatching
 * `POST /api/skills/:id/execute`.
 *
 * @feature robots
 */

import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Square } from 'lucide-react';
import { Button, Panel, StatusTag, errorMessage, toast, type Tone } from '@/shared/components/ui';
import { deploymentApi } from '@/features/deployment/api/deploymentApi';
import { Readout } from './common';

export interface AutonomousExecutionPanelProps {
  robotId: string;
}

type RunStatus = 'running' | 'completed' | 'aborted' | 'error';

const STATUS: Record<RunStatus, { label: string; tone: Tone }> = {
  running: { label: 'Running', tone: 'live' },
  completed: { label: 'Completed', tone: 'success' },
  aborted: { label: 'Stopped', tone: 'gated' },
  error: { label: 'Error', tone: 'stopped' },
};

export function AutonomousExecutionPanel({ robotId }: AutonomousExecutionPanelProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const skillId = searchParams.get('executing');

  const [startedAt] = useState(() => Date.now());
  const [elapsed, setElapsed] = useState(0);
  const [aborting, setAborting] = useState(false);
  const [status, setStatus] = useState<RunStatus>('running');
  const [error, setError] = useState<string | null>(null);
  const [steps, setSteps] = useState<number | null>(null);

  // Tick the elapsed counter while the run is active.
  useEffect(() => {
    if (!skillId || status !== 'running') return;
    const t = setInterval(() => setElapsed(Date.now() - startedAt), 200);
    return () => clearInterval(t);
  }, [skillId, startedAt, status]);

  // The modal unmounts before its fetch completes, so its broadcast is the only
  // way this panel hears the final status.
  useEffect(() => {
    if (!skillId) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{
        skillId: string;
        robotId: string;
        result?: { status: string; output?: { steps?: number }; error?: string };
        error?: string;
      }>).detail;
      if (detail.skillId !== skillId || detail.robotId !== robotId) return;
      if (detail.error) {
        setStatus('error');
        setError(detail.error);
        return;
      }
      const r = detail.result;
      if (!r) return;
      if (r.status === 'completed') {
        setStatus('completed');
        if (r.output?.steps != null) setSteps(r.output.steps);
      } else if (r.status === 'cancelled' || r.status === 'aborted') {
        setStatus('aborted');
      } else {
        setStatus('error');
        setError(r.error ?? r.status);
      }
    };
    window.addEventListener('skill:execution:result', handler);
    return () => window.removeEventListener('skill:execution:result', handler);
  }, [skillId, robotId]);

  if (!skillId) return null;

  const closePanel = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('executing');
    setSearchParams(next, { replace: true });
  };

  const handleAbort = async () => {
    setAborting(true);
    setError(null);
    try {
      await deploymentApi.abortSkill(skillId, robotId);
      setStatus('aborted');
      toast.success('Skill stopped');
      setTimeout(closePanel, 800);
    } catch (err) {
      const message = errorMessage(err, 'Failed to stop');
      setError(message);
      setStatus('error');
      toast.error("Couldn't stop skill", { description: message });
    } finally {
      setAborting(false);
    }
  };

  const meta = STATUS[status];

  return (
    <Panel variant="highlight">
      <Panel.Header
        title="Running skill"
        description={
          <>
            Skill <code className="font-mono">{skillId.slice(0, 8)}…</code> runs closed-loop VLA
            inference on the robot.
          </>
        }
        actions={
          <>
            <StatusTag tone={meta.tone} dot pulse={status === 'running'}>
              {meta.label}
            </StatusTag>
            {status === 'running' ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void handleAbort()}
                isLoading={aborting}
                loadingText="Stopping…"
                leftIcon={<Square className="h-4 w-4" strokeWidth={1.75} />}
              >
                Stop skill
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={closePanel}>
                Close
              </Button>
            )}
          </>
        }
      />
      <Panel.Body className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-8">
          <Readout label="Elapsed" value={(elapsed / 1000).toFixed(1)} unit="s" />
          {steps != null && <Readout label="Steps" value={steps} />}
        </div>
        {error && (
          <p role="alert" className="text-xs text-signal-stopped">
            {error}
          </p>
        )}
      </Panel.Body>
    </Panel>
  );
}

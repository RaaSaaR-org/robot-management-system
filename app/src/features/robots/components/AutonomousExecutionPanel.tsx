/**
 * @file AutonomousExecutionPanel.tsx
 * @description Live execution panel shown on the Robot Detail page when a
 * skill is running on this robot. Reads `?executing=<skillId>` from the URL,
 * shows the live camera feed (reused from datacollection), an elapsed timer,
 * and an Abort button. Disappears when the run finishes or is aborted.
 *
 * Added by TASK-146 — pairs with `RunSkillModal` which navigates here after
 * dispatching `POST /api/skills/:id/execute`.
 *
 * @feature robots
 */

import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Activity, Square } from 'lucide-react';
import { Button, Card } from '@/shared/components/ui';
import { CameraStreamView } from '@/features/datacollection/components/CameraStreamView';
import { deploymentApi } from '@/features/deployment/api/deploymentApi';

export interface AutonomousExecutionPanelProps {
  robotId: string;
}

export function AutonomousExecutionPanel({ robotId }: AutonomousExecutionPanelProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const skillId = searchParams.get('executing');

  const [startedAt] = useState(() => Date.now());
  const [elapsed, setElapsed] = useState(0);
  const [aborting, setAborting] = useState(false);
  const [status, setStatus] = useState<'running' | 'completed' | 'aborted' | 'error'>('running');
  const [error, setError] = useState<string | null>(null);
  const [steps, setSteps] = useState<number | null>(null);

  // Tick the elapsed counter every 200ms while the run is active.
  useEffect(() => {
    if (!skillId || status !== 'running') return;
    const t = setInterval(() => setElapsed(Date.now() - startedAt), 200);
    return () => clearInterval(t);
  }, [skillId, startedAt, status]);

  // Listen for the modal's broadcast when the executeSkill promise resolves.
  // The modal unmounts before its fetch completes, so this is the only way
  // the panel hears about the final status.
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

  const handleAbort = async () => {
    setAborting(true);
    setError(null);
    try {
      await deploymentApi.abortSkill(skillId, robotId);
      setStatus('aborted');
      // Clear the query param so the panel closes after a beat.
      setTimeout(() => {
        const next = new URLSearchParams(searchParams);
        next.delete('executing');
        setSearchParams(next, { replace: true });
      }, 800);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to abort';
      setError(message);
      setStatus('error');
    } finally {
      setAborting(false);
    }
  };

  const handleClose = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('executing');
    setSearchParams(next, { replace: true });
  };

  const seconds = (elapsed / 1000).toFixed(1);

  return (
    <Card className="border-orange-300 dark:border-orange-700/60 bg-orange-50/40 dark:bg-orange-900/10">
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-orange-500 animate-pulse" />
            <h3 className="text-sm font-semibold text-theme-primary">
              Autonomous execution
            </h3>
            <span className="text-xs text-theme-secondary">
              skill <code className="font-mono">{skillId.slice(0, 8)}…</code>
            </span>
          </div>
          {status === 'running' ? (
            <Button
              variant="primary"
              size="sm"
              onClick={handleAbort}
              disabled={aborting}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              <Square className="w-3 h-3 mr-1.5 inline-block fill-current" />
              {aborting ? 'Aborting…' : 'Abort'}
            </Button>
          ) : (
            <Button variant="primary" size="sm" onClick={handleClose}>
              Close
            </Button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Live camera tiles — reuse the existing MJPEG component */}
          <CameraStreamView
            robotId={robotId}
            cameraName="top"
            label="Top"
            className="aspect-video"
          />
          <CameraStreamView
            robotId={robotId}
            cameraName="wrist"
            label="Wrist"
            className="aspect-video"
          />

          {/* Stats column */}
          <div className="flex flex-col justify-center gap-2 px-2">
            <div>
              <div className="text-xs text-theme-secondary uppercase tracking-wide">Elapsed</div>
              <div className="text-2xl font-mono text-theme-primary">{seconds}s</div>
            </div>
            <div>
              <div className="text-xs text-theme-secondary uppercase tracking-wide">Status</div>
              <div
                className={`text-sm font-medium ${
                  status === 'running'
                    ? 'text-orange-500'
                    : status === 'completed'
                      ? 'text-green-500'
                      : status === 'aborted'
                        ? 'text-yellow-500'
                        : 'text-red-500'
                }`}
              >
                {status === 'running'
                  ? 'Running'
                  : status === 'completed'
                    ? 'Completed'
                    : status === 'aborted'
                      ? 'Aborted'
                      : 'Error'}
              </div>
            </div>
            {steps != null && (
              <div>
                <div className="text-xs text-theme-secondary uppercase tracking-wide">Steps</div>
                <div className="text-sm font-mono text-theme-primary">{steps}</div>
              </div>
            )}
            {error && (
              <p className="text-xs text-red-600 dark:text-red-400 mt-1">{error}</p>
            )}
          </div>
        </div>

        <p className="text-xs text-theme-tertiary mt-3">
          Closed-loop VLA inference is running on the robot. Watch the camera tiles for
          live progress. Click Abort to stop immediately.
        </p>
      </div>
    </Card>
  );
}

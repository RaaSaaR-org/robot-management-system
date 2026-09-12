/**
 * @file NewSessionPage.tsx
 * @description New recording session: a big-editor page with Panels for the
 *              input type and the robot/task, and a sticky footer.
 * @feature datacollection
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Headset } from 'lucide-react';
import {
  Button, FormField, Input, InfoIcon, PageHeader, Panel, Select, errorMessage, toast,
} from '@/shared/components/ui';
import { SessionTypeSelector } from '../components/SessionTypeSelector';
import { useDataCollectionStore } from '../store/datacollectionStore';
import { useRobotsStore } from '../../robots/store/robotsStore';
import { useAuthStore } from '@/features/auth/store/authStore';
import type { TeleoperationType, CreateSessionRequest } from '../types/datacollection.types';

interface Errors { type?: string; robotId?: string; languageInstr?: string }

export function NewSessionPage() {
  const navigate = useNavigate();
  const createSession = useDataCollectionStore((s) => s.createSession);
  const setActiveSession = useDataCollectionStore((s) => s.setActiveSession);
  const clearError = useDataCollectionStore((s) => s.clearError);
  const robots = useRobotsStore((s) => s.robots);
  const fetchRobots = useRobotsStore((s) => s.fetchRobots);
  // Real user id when signed in; dev mode injects a mock user.
  const currentUser = useAuthStore((s) => s.user);

  useEffect(() => { clearError(); }, [clearError]);
  useEffect(() => { fetchRobots(); }, [fetchRobots]);

  const [type, setType] = useState<TeleoperationType | undefined>();
  const [robotId, setRobotId] = useState('');
  const [task, setTask] = useState('');
  const [numEpisodes, setNumEpisodes] = useState('3');
  const [episodeTimeS, setEpisodeTimeS] = useState('30');
  const [fps, setFps] = useState('10');
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string>();
  const [saving, setSaving] = useState(false);

  const isVrType = type === 'vr_quest' || type === 'vr_vision_pro';
  const robotOptions = robots.map((r) => ({
    value: r.id,
    label: `${r.name} (${r.model})${r.status === 'offline' ? ' — offline' : ''}`,
  }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const next: Errors = {};
    if (!type) next.type = 'Choose how you will teleoperate the robot.';
    if (!robotId) next.robotId = 'Choose the robot to record.';
    if (!task.trim()) next.languageInstr = 'Describe the task the robot should learn.';
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setSaving(true);
    setFormError(undefined);
    try {
      const request: CreateSessionRequest = {
        operatorId: currentUser?.id ?? 'dev-operator',
        robotId,
        type: type!,
        fps: parseInt(fps, 10) || 10,
        languageInstr: task.trim(),
        numEpisodes: parseInt(numEpisodes, 10) || 3,
        episodeTimeS: parseInt(episodeTimeS, 10) || 30,
      };
      const session = await createSession(request);
      setActiveSession(session);
      toast.success('Session created', { description: task.trim() });
      navigate(`/data-collection/${session.id}`);
    } catch (err) {
      const message = errorMessage(err);
      setFormError(message);
      toast.error("Couldn't create session", { description: message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="flex flex-col gap-6" onSubmit={handleSubmit} noValidate>
      <PageHeader
        eyebrow="Build"
        back={{ to: '/data-collection', label: 'Data collection' }}
        title="New session"
        description="Choose how you will teleoperate, the robot and the task to record."
      />

      <Panel>
        <Panel.Header
          title="Input"
          description="How the operator controls the robot while every frame is captured."
        />
        <Panel.Body className="flex flex-col gap-4">
          <SessionTypeSelector
            value={type}
            onChange={(t) => { setType(t); setErrors((p) => ({ ...p, type: undefined })); }}
            disabled={saving}
            invalid={!!errors.type}
          />
          {errors.type && <p role="alert" className="text-xs text-signal-stopped">{errors.type}</p>}

          {isVrType && (
            <Panel variant="inset" padding="sm" data-testid="vr-prerequisites">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink-primary">
                <Headset className="h-4 w-4 text-primary" strokeWidth={1.75} />
                Before you start in VR
              </div>
              <ol className="flex list-decimal flex-col gap-1 pl-5 text-[13px] text-ink-secondary">
                <li>Put the headset on the same network as this app.</li>
                <li>Open this app&apos;s URL in the headset browser and go to the session.</li>
                <li>Press <span className="font-medium text-ink-primary">Enter VR</span> on the session page, then grip a controller to move that arm.</li>
              </ol>
              <p className="mt-2 text-xs text-ink-tertiary">
                No headset? The session page has a &ldquo;Simulate VR input&rdquo; switch that streams synthetic motion.
              </p>
            </Panel>
          )}
        </Panel.Body>
      </Panel>

      <Panel>
        <Panel.Header title="Robot and task" />
        <Panel.Body className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormField label="Robot" required error={errors.robotId} hint="The robot has to be online to record.">
            <Select
              placeholder="Choose a robot…"
              options={robotOptions}
              value={robotId}
              disabled={saving}
              onChange={(e) => { setRobotId(e.target.value); setErrors((p) => ({ ...p, robotId: undefined })); }}
            />
          </FormField>
          <FormField
            label="Task"
            required
            error={errors.languageInstr}
            hint="Becomes the language instruction the policy is trained on."
          >
            <Input
              value={task}
              disabled={saving}
              placeholder="Pick up the red block and place it on the plate"
              onChange={(e) => { setTask(e.target.value); setErrors((p) => ({ ...p, languageInstr: undefined })); }}
            />
          </FormField>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 md:col-span-2">
            <FormField label="Episodes" hint="Takes to record">
              <Input type="number" min={1} max={100} value={numEpisodes} disabled={saving} onChange={(e) => setNumEpisodes(e.target.value)} />
            </FormField>
            <FormField label="Episode length" hint="Seconds; recording stops after this">
              <Input type="number" min={5} max={300} value={episodeTimeS} disabled={saving} onChange={(e) => setEpisodeTimeS(e.target.value)} />
            </FormField>
            <FormField
              label="Frame rate"
              aside={<InfoIcon content="Frames per second. Higher captures smoother motion but makes larger datasets. 10 fps suits most tasks." />}
              hint="fps, default 10"
            >
              <Input type="number" min={1} max={120} value={fps} disabled={saving} onChange={(e) => setFps(e.target.value)} />
            </FormField>
          </div>
        </Panel.Body>
      </Panel>

      <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-end gap-2 border-t border-line bg-canvas px-4 py-3 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        {formError && (
          <p role="alert" className="mr-auto min-w-0 flex-1 basis-full truncate text-[13px] text-signal-stopped sm:basis-auto">
            {formError}
          </p>
        )}
        <Button variant="ghost" disabled={saving} onClick={() => navigate('/data-collection')} className="flex-1 sm:flex-none">
          Cancel
        </Button>
        <Button type="submit" isLoading={saving} loadingText="Creating…" className="flex-1 sm:flex-none">
          Create session
        </Button>
      </div>
    </form>
  );
}

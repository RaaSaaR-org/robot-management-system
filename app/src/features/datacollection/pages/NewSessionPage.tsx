/**
 * @file NewSessionPage.tsx
 * @description New recording session (TASK-392). The default view asks only
 *              what every recording needs — robot, task, input device and how
 *              many episodes — with one primary "Start session". Episode
 *              length, frame rate, the dataset name, the less common input
 *              devices and the operator sit under a collapsed "Advanced
 *              options" disclosure that summarises what differs from the
 *              defaults. Robot, device and the advanced values are remembered
 *              per user; recent task instructions come back as chips.
 * @feature datacollection
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Headset } from 'lucide-react';
import {
  Button, Disclosure, FormField, Input, InfoIcon, PageHeader, Panel, Select, ToggleChip,
  errorMessage, humanizeStatus, toast,
} from '@/shared/components/ui';
import { SessionTypeSelector } from '../components/SessionTypeSelector';
import { useDataCollectionStore } from '../store/datacollectionStore';
import { useRobotsStore } from '../../robots/store/robotsStore';
import { useAuthStore } from '@/features/auth/store/authStore';
import { TELEOPERATION_TYPE_LABELS } from '../types/datacollection.types';
import type { TeleoperationType, CreateSessionRequest } from '../types/datacollection.types';
import {
  ADVANCED_INPUT_TYPES, DATASET_REPO_ID, NEW_SESSION_DEFAULTS, PRIMARY_INPUT_TYPES,
  loadNewSessionPrefs, mergeRecentTasks, saveNewSessionPrefs, withRecentTask,
} from '../utils/newSessionPrefs';

interface Errors {
  robotId?: string;
  languageInstr?: string;
  numEpisodes?: string;
  episodeTimeS?: string;
  fps?: string;
  datasetRepoId?: string;
}

const ADVANCED_FIELDS: (keyof Errors)[] = ['episodeTimeS', 'fps', 'datasetRepoId'];

/** An integer within [min, max], or an error sentence. */
function intInRange(value: string, min: number, max: number, what: string): string | undefined {
  const n = Number(value);
  if (value.trim() === '' || !Number.isInteger(n) || n < min || n > max) {
    return `${what} must be a whole number from ${min} to ${max}.`;
  }
  return undefined;
}

const isOnline = (status: string) => status !== 'offline';

export function NewSessionPage() {
  const navigate = useNavigate();
  const createSession = useDataCollectionStore((s) => s.createSession);
  const setActiveSession = useDataCollectionStore((s) => s.setActiveSession);
  const clearError = useDataCollectionStore((s) => s.clearError);
  const pastSessions = useDataCollectionStore((s) => s.sessions);
  const robots = useRobotsStore((s) => s.robots);
  const fetchRobots = useRobotsStore((s) => s.fetchRobots);
  // Real user id when signed in; dev mode injects a mock user.
  const currentUser = useAuthStore((s) => s.user);
  const userId = currentUser?.id ?? null;

  useEffect(() => { clearError(); }, [clearError]);
  useEffect(() => { fetchRobots(); }, [fetchRobots]);

  // Read once per user: what this operator chose last time.
  const prefs = useMemo(() => loadNewSessionPrefs(userId), [userId]);

  const [type, setType] = useState<TeleoperationType>(prefs.type ?? NEW_SESSION_DEFAULTS.type);
  const [robotId, setRobotId] = useState('');
  const [task, setTask] = useState('');
  const [numEpisodes, setNumEpisodes] = useState(String(prefs.numEpisodes ?? NEW_SESSION_DEFAULTS.numEpisodes));
  const [episodeTimeS, setEpisodeTimeS] = useState(String(prefs.episodeTimeS ?? NEW_SESSION_DEFAULTS.episodeTimeS));
  const [fps, setFps] = useState(String(prefs.fps ?? NEW_SESSION_DEFAULTS.fps));
  const [datasetRepoId, setDatasetRepoId] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const robotTouched = useRef(false);

  // Online robots first, each with its status; offline ones stay choosable at the end.
  const sortedRobots = useMemo(
    () => [...robots].sort(
      (a, b) => Number(isOnline(b.status)) - Number(isOnline(a.status)) || a.name.localeCompare(b.name),
    ),
    [robots],
  );
  const onlineRobots = useMemo(() => sortedRobots.filter((r) => isOnline(r.status)), [sortedRobots]);
  const robotOptions = sortedRobots.map((r) => ({
    value: r.id,
    label: `${r.name} (${r.model}) · ${humanizeStatus(r.status)}`,
  }));
  const selectedRobot = robots.find((r) => r.id === robotId);

  // Preselect once the list arrives: the remembered robot if it is online,
  // else the only online robot. Never overrides a choice the user made.
  useEffect(() => {
    if (robotTouched.current || robotId) return;
    const remembered = onlineRobots.find((r) => r.id === prefs.robotId);
    const pick = remembered ?? (onlineRobots.length === 1 ? onlineRobots[0] : undefined);
    if (pick) setRobotId(pick.id);
  }, [onlineRobots, prefs.robotId, robotId]);

  const recentTasks = useMemo(
    () => mergeRecentTasks(prefs.recentTasks ?? [], pastSessions.map((s) => s.languageInstr)),
    [prefs.recentTasks, pastSessions],
  );

  const isVrType = type === 'vr_quest' || type === 'vr_vision_pro';
  const advancedType = ADVANCED_INPUT_TYPES.includes(type);

  // What differs from a fresh form, for the closed disclosure.
  const advancedSummary = [
    advancedType && `Input ${TELEOPERATION_TYPE_LABELS[type]}`,
    episodeTimeS !== String(NEW_SESSION_DEFAULTS.episodeTimeS) && `Episode length ${episodeTimeS || '—'} s`,
    fps !== String(NEW_SESSION_DEFAULTS.fps) && `Frame rate ${fps || '—'} fps`,
    datasetRepoId.trim() && `Dataset ${datasetRepoId.trim()}`,
  ].filter(Boolean).join(' · ');

  const clearFieldError = (field: keyof Errors) => setErrors((p) => ({ ...p, [field]: undefined }));

  const validate = (): Errors => {
    const next: Errors = {
      robotId: robotId ? undefined : 'Choose the robot to record.',
      languageInstr: task.trim() ? undefined : 'Describe the task the robot should learn.',
      numEpisodes: intInRange(numEpisodes, 1, 100, 'Episodes'),
      episodeTimeS: intInRange(episodeTimeS, 5, 300, 'Episode length'),
      fps: intInRange(fps, 1, 120, 'Frame rate'),
      datasetRepoId:
        datasetRepoId.trim() && !DATASET_REPO_ID.test(datasetRepoId.trim())
          ? 'Use a name or owner/name with letters, digits, dots, dashes and underscores.'
          : undefined,
    };
    for (const k of Object.keys(next) as (keyof Errors)[]) if (!next[k]) delete next[k];
    return next;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const next = validate();
    setErrors(next);
    // An error nobody can see is no help: open the section that holds it.
    if (ADVANCED_FIELDS.some((f) => next[f])) setAdvancedOpen(true);
    if (Object.keys(next).length > 0) return;

    const request: CreateSessionRequest = {
      operatorId: currentUser?.id ?? 'dev-operator',
      robotId,
      type,
      fps: Number(fps),
      languageInstr: task.trim(),
      numEpisodes: Number(numEpisodes),
      episodeTimeS: Number(episodeTimeS),
      ...(datasetRepoId.trim() ? { datasetRepoId: datasetRepoId.trim() } : {}),
    };
    // The dataset name is not remembered: it names one dataset.
    saveNewSessionPrefs(userId, {
      robotId,
      type,
      numEpisodes: request.numEpisodes,
      episodeTimeS: request.episodeTimeS,
      fps: request.fps,
      recentTasks: withRecentTask(prefs.recentTasks, task),
    });

    setSaving(true);
    setFormError(undefined);
    try {
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
        description="Pick the robot, say what it should learn and how you will control it."
      />

      <Panel>
        <Panel.Body className="flex flex-col gap-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FormField
              label="Robot"
              required
              error={errors.robotId}
              hint={
                selectedRobot && !isOnline(selectedRobot.status)
                  ? 'This robot is offline. Start its robot agent before you record.'
                  : robots.length > 0 && onlineRobots.length === 0
                    ? 'No robot is online right now.'
                    : 'Online robots are listed first.'
              }
            >
              <Select
                placeholder="Choose a robot…"
                options={robotOptions}
                value={robotId}
                disabled={saving}
                onChange={(e) => { robotTouched.current = true; setRobotId(e.target.value); clearFieldError('robotId'); }}
              />
            </FormField>
            <div className="flex min-w-0 flex-col gap-2">
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
                  onChange={(e) => { setTask(e.target.value); clearFieldError('languageInstr'); }}
                />
              </FormField>
              {recentTasks.length > 0 && (
                <div
                  role="group"
                  aria-label="Recent tasks"
                  data-testid="recent-tasks"
                  className="flex min-w-0 flex-wrap items-center gap-1.5"
                >
                  <span className="text-xs text-ink-tertiary">Recent</span>
                  {recentTasks.map((t) => (
                    <ToggleChip
                      key={t}
                      active={task.trim() === t}
                      disabled={saving}
                      title={t}
                      className="min-w-0 max-w-full"
                      onClick={() => { setTask(t); clearFieldError('languageInstr'); }}
                    >
                      <span className="truncate">{t}</span>
                    </ToggleChip>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-ink-secondary">Input device</span>
            <SessionTypeSelector
              types={PRIMARY_INPUT_TYPES}
              label="Input device"
              columns={3}
              value={type}
              onChange={setType}
              disabled={saving}
            />
            {advancedType && (
              <p className="text-xs text-ink-tertiary" data-testid="advanced-input-note">
                Using {TELEOPERATION_TYPE_LABELS[type]}, chosen under Advanced options.
              </p>
            )}
          </div>

          {isVrType && (
            <Panel variant="inset" padding="sm" data-testid="vr-prerequisites">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink-primary">
                <Headset className="h-4 w-4 text-primary" strokeWidth={1.75} />
                Before you start in VR
              </div>
              <ol className="flex list-decimal flex-col gap-1 pl-5 text-[13px] text-ink-secondary">
                <li>Open this app in the headset browser on a secure page: over HTTPS, or on localhost through <code className="font-mono text-xs">adb reverse</code> with the headset on USB.</li>
                <li>Go to the session you are about to create.</li>
                <li>Press <span className="font-medium text-ink-primary">Enter VR</span> on the session page, then grip a controller to move that arm.</li>
              </ol>
              <p className="mt-2 text-xs text-ink-tertiary">
                The session page checks the robot, camera and input before you record. No headset? It also has a &ldquo;Simulate VR input&rdquo; switch.
              </p>
            </Panel>
          )}

          <FormField
            label="Episodes"
            error={errors.numEpisodes}
            hint="How many takes to record. You can end early."
            className="sm:max-w-xs"
          >
            <Input
              type="number"
              min={1}
              max={100}
              value={numEpisodes}
              disabled={saving}
              onChange={(e) => { setNumEpisodes(e.target.value); clearFieldError('numEpisodes'); }}
            />
          </FormField>
        </Panel.Body>
      </Panel>

      <Panel>
        <Disclosure
          title="Advanced options"
          summary={advancedSummary || 'Episode length, frame rate, dataset name and other input devices'}
          open={advancedOpen}
          onOpenChange={setAdvancedOpen}
          data-testid="advanced-options"
          contentClassName="flex flex-col gap-6"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <FormField label="Episode length" error={errors.episodeTimeS} hint="Seconds; recording stops after this">
              <Input
                type="number"
                min={5}
                max={300}
                value={episodeTimeS}
                disabled={saving}
                onChange={(e) => { setEpisodeTimeS(e.target.value); clearFieldError('episodeTimeS'); }}
              />
            </FormField>
            <FormField
              label="Frame rate"
              error={errors.fps}
              aside={<InfoIcon content="Frames per second. Higher captures smoother motion but makes larger datasets. 10 fps suits most tasks." />}
              hint={`fps, default ${NEW_SESSION_DEFAULTS.fps}`}
            >
              <Input
                type="number"
                min={1}
                max={120}
                value={fps}
                disabled={saving}
                onChange={(e) => { setFps(e.target.value); clearFieldError('fps'); }}
              />
            </FormField>
            <FormField
              label="Dataset name"
              aside="Optional"
              error={errors.datasetRepoId}
              hint="A name or owner/name. Empty uses the task text."
            >
              <Input
                value={datasetRepoId}
                disabled={saving}
                placeholder="e.g. neodem/g1-pick-cube"
                onChange={(e) => { setDatasetRepoId(e.target.value); clearFieldError('datasetRepoId'); }}
              />
            </FormField>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-ink-secondary">Other input devices</span>
            <SessionTypeSelector
              types={ADVANCED_INPUT_TYPES}
              label="Other input devices"
              columns={3}
              value={type}
              onChange={setType}
              disabled={saving}
            />
          </div>

          <p className="text-xs text-ink-tertiary" data-testid="operator-line">
            Recorded as <span className="font-medium text-ink-secondary">{currentUser?.name ?? 'the development operator'}</span>.
          </p>
        </Disclosure>
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
          Start session
        </Button>
      </div>
    </form>
  );
}

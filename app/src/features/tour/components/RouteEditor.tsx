/**
 * @file RouteEditor.tsx
 * @description Create/edit a tour as one form: Basics (name, robot, language,
 *              greeting place, armed, greet on sight), Stops (a vertical
 *              stepper of inset cards with talk track, facts and demo) and What
 *              the robot says (welcome, offer, goodbye, site card), next to a
 *              sticky Preview. Problems show at their fields after a save
 *              attempt; the sticky footer holds Cancel and Save. The structural
 *              twin of the patrol route editor.
 * @feature tour
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Plus } from 'lucide-react';
import { Button, FormField, Input, KeyValueList, Panel, Select, Switch, Textarea, toast } from '@/shared/components/ui';
import { getErrorMessage } from '@/shared/utils/error';
import { voiceApi } from '@/features/robots/api/voiceApi';
import { RoutePath } from '@/features/patrol/components/opsUi';
import type { SpokenLanguage, TourRoute, TourRouteInput, TourStop } from '../types/tour.types';
import { SpokenLanguages, TOUR_FACTS_MAX, TOUR_FACT_MAX, TOUR_HEADLINE_MAX, TOUR_SITE_CARD_MAX, TOUR_STOPS_MAX, TOUR_TALK_TRACK_MAX } from '../types/tour.types';
import { useTourStore, selectPlacesForRobot, selectSkills } from '../store/tourStore';
import { chunkTalkTrack, estimateTourSeconds, formatEstimate } from '../utils/tourFormat';
import { FactList } from './FactList';
import { StopCard, type StopErrors } from './StopCard';

// ============================================================================
// TYPES
// ============================================================================

export interface RouteEditorRobot {
  id: string;
  name: string;
}

export interface RouteEditorProps {
  /** Existing tour to edit; null/undefined = new tour. */
  route?: TourRoute | null;
  robots: RouteEditorRobot[];
  /** Preselect a robot for a new tour. */
  defaultRobotId?: string | null;
  onSaved: (route: TourRoute) => void;
  onCancel?: () => void;
  className?: string;
}

export interface Draft {
  name: string;
  robotId: string;
  twinId: string;
  language: SpokenLanguage;
  greetingPlaceId: string;
  greeting: string;
  offer: string;
  farewell: string;
  siteCard: string[];
  stops: TourStop[];
  enabled: boolean;
  autoGreet: boolean;
}

// ============================================================================
// HELPERS (pure)
// ============================================================================

const MANUAL = '__manual__';
/** Default dwell, mirroring `AGENT_TOUR_DWELL_S` on the robot. */
const DEFAULT_DWELL_S = 12;

function newId(prefix: string): string {
  const rnd =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${rnd}`;
}

export function draftFromRoute(route: TourRoute | null | undefined, defaultRobotId?: string | null): Draft {
  return {
    name: route?.name ?? '',
    robotId: route?.robotId ?? defaultRobotId ?? '',
    twinId: route?.twinId ?? '',
    language: route?.language ?? 'de',
    greetingPlaceId: route?.greetingPlaceId ?? '',
    greeting: route?.greeting ?? '',
    offer: route?.offer ?? '',
    farewell: route?.farewell ?? '',
    siteCard: route?.siteCard ? [...route.siteCard] : [],
    stops: route?.stops ? route.stops.map((s) => ({ ...s, facts: [...s.facts], demo: s.demo ? { ...s.demo } : null })) : [],
    enabled: route?.enabled ?? true,
    autoGreet: route?.autoGreet ?? false,
  };
}

/** Pure: reorder a stop by one slot; out-of-range moves are no-ops. */
export function moveStop(list: TourStop[], index: number, delta: -1 | 1): TourStop[] {
  const target = index + delta;
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item);
  return next;
}

/** Pure: the body the server accepts, from the editor draft. */
export function draftToInput(draft: Draft): TourRouteInput {
  return {
    name: draft.name.trim(),
    robotId: draft.robotId || null,
    twinId: draft.twinId || null,
    language: draft.language,
    greetingPlaceId: draft.greetingPlaceId.trim(),
    greeting: draft.greeting.trim(),
    offer: draft.offer.trim(),
    farewell: draft.farewell.trim(),
    siteCard: draft.siteCard.map((f) => f.trim()).filter(Boolean),
    stops: draft.stops.map((stop) => ({
      id: stop.id,
      placeId: stop.placeId.trim(),
      headline: (stop.headline || stop.placeId).trim(),
      talkTrack: stop.talkTrack.trim(),
      facts: stop.facts.map((f) => f.trim()).filter(Boolean),
      demo: stop.demo ? { ...stop.demo, expectSeconds: Math.max(0, Math.round(stop.demo.expectSeconds)) } : null,
      dwellS: Math.max(0, Math.round(stop.dwellS)),
      askToContinue: stop.askToContinue,
    })),
    enabled: draft.enabled,
    autoGreet: draft.autoGreet,
  };
}

/**
 * Pure: what stops the draft from being saved; empty when it can be. The caps
 * are checked here as well as clamped in the inputs — a route loaded from an
 * older payload (or a longer server cap) must not be silently re-saved over the
 * limit the ROBOT enforces when it builds the blocks.
 */
export function validateDraft(draft: Draft): string[] {
  const problems: string[] = [];
  if (!draft.name.trim()) problems.push('Give the tour a name.');
  if (!draft.greetingPlaceId.trim()) problems.push('Say where the robot waits for visitors and returns to.');
  if (!draft.greeting.trim()) problems.push('Write the welcome the robot says to a visitor.');
  if (!draft.offer.trim()) problems.push('Write the offer ("shall I show you around?").');
  if (!draft.farewell.trim()) problems.push('Write the goodbye.');
  if (draft.stops.length === 0) problems.push('Add at least one stop.');
  if (draft.stops.length > TOUR_STOPS_MAX) problems.push(`A tour may have at most ${TOUR_STOPS_MAX} stops.`);
  if (draft.siteCard.filter((f) => f.trim()).length > TOUR_SITE_CARD_MAX)
    problems.push(`The site card holds at most ${TOUR_SITE_CARD_MAX} facts.`);
  draft.stops.forEach((stop, i) => {
    const n = i + 1;
    if (!stop.placeId.trim()) problems.push(`Stop ${n} has no place.`);
    if (!stop.headline.trim()) problems.push(`Stop ${n} has no headline.`);
    if (stop.headline.length > TOUR_HEADLINE_MAX) problems.push(`Stop ${n}'s headline is over ${TOUR_HEADLINE_MAX} characters.`);
    if (!stop.talkTrack.trim()) problems.push(`Stop ${n} has no talk track — the robot would stand there in silence.`);
    if (stop.talkTrack.length > TOUR_TALK_TRACK_MAX) problems.push(`Stop ${n}'s talk track is over ${TOUR_TALK_TRACK_MAX} characters.`);
    const facts = stop.facts.filter((f) => f.trim());
    if (facts.length > TOUR_FACTS_MAX) problems.push(`Stop ${n} has more than ${TOUR_FACTS_MAX} facts.`);
    if (facts.some((f) => f.length > TOUR_FACT_MAX)) problems.push(`A fact of stop ${n} is over ${TOUR_FACT_MAX} characters.`);
    if (stop.demo && !stop.demo.skillId) problems.push(`Stop ${n}'s demo has no skill.`);
  });
  return problems;
}

interface FieldErrors {
  name?: string;
  greetingPlaceId?: string;
  greeting?: string;
  offer?: string;
  farewell?: string;
  stops?: string;
  siteCard?: string;
  byStop: Record<number, StopErrors>;
}

/** Pure: sorts validateDraft's messages onto the fields they belong to. */
function fieldErrors(problems: string[]): FieldErrors {
  const out: FieldErrors = { byStop: {} };
  for (const p of problems) {
    const m = /[Ss]top (\d+)/.exec(p);
    if (m && !p.startsWith('Add at least') && !p.startsWith('A tour may')) {
      const i = Number(m[1]) - 1;
      const e = (out.byStop[i] = out.byStop[i] ?? {});
      if (p.includes('no place')) e.place = 'Choose or type a place.';
      else if (p.includes('headline')) e.headline = p.includes('no headline') ? 'Give the stop a headline.' : p;
      else if (p.includes('talk track')) e.talkTrack = p.includes('no talk track') ? 'Write what the robot says here.' : p;
      else if (p.includes('demo')) e.demo = 'Choose a skill or No demo.';
      else e.facts = p;
    } else if (p.startsWith('Give the tour')) out.name = p;
    else if (p.startsWith('Say where')) out.greetingPlaceId = p;
    else if (p.startsWith('Write the welcome')) out.greeting = p;
    else if (p.startsWith('Write the offer')) out.offer = p;
    else if (p.startsWith('Write the goodbye')) out.farewell = p;
    else if (p.startsWith('The site card')) out.siteCard = p;
    else out.stops = p;
  }
  return out;
}

function countErrors(e: FieldErrors): number {
  const top = [e.name, e.greetingPlaceId, e.greeting, e.offer, e.farewell, e.stops, e.siteCard].filter(Boolean).length;
  return top + Object.values(e.byStop).reduce((n, s) => n + Object.values(s).filter(Boolean).length, 0);
}

// ============================================================================
// COMPONENT
// ============================================================================

export const RouteEditor = memo(function RouteEditor({ route, robots, defaultRobotId, onSaved, onCancel, className }: RouteEditorProps) {
  const [draft, setDraft] = useState<Draft>(() => draftFromRoute(route, defaultRobotId));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [pickPlace, setPickPlace] = useState<string>('');
  const [manualPlace, setManualPlace] = useState('');
  /** Result of the last "Hear it" — one line, shared by every stop. */
  const [previewNote, setPreviewNote] = useState<string | null>(null);
  const [previewingStopId, setPreviewingStopId] = useState<string | null>(null);
  /** Stop ids whose details are folded away (inputs stay mounted). */
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(route?.stops.map((s) => s.id) ?? []));
  const formRef = useRef<HTMLFormElement>(null);

  const saveRoute = useTourStore((s) => s.saveRoute);
  const fetchPlaces = useTourStore((s) => s.fetchPlaces);
  const fetchSkills = useTourStore((s) => s.fetchSkills);
  const places = useTourStore(selectPlacesForRobot(draft.robotId || null));
  const placesStatus = useTourStore((s) => (draft.robotId ? (s.placesStatus[draft.robotId] ?? 'idle') : 'idle'));
  const skills = useTourStore(selectSkills);

  // Reset the draft when a different tour is opened.
  useEffect(() => {
    setDraft(draftFromRoute(route, defaultRobotId));
    setCollapsed(new Set(route?.stops.map((s) => s.id) ?? []));
    setSubmitted(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route?.id]);

  useEffect(() => {
    if (draft.robotId) void fetchPlaces(draft.robotId);
  }, [draft.robotId, fetchPlaces]);

  useEffect(() => {
    void fetchSkills();
  }, [fetchSkills]);

  const placeName = useCallback((id: string) => places?.find((p) => p.id === id)?.name ?? id, [places]);
  const update = useCallback((patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch })), []);
  const updateStop = useCallback((index: number, patch: Partial<TourStop>) => {
    setDraft((d) => ({ ...d, stops: d.stops.map((s, i) => (i === index ? { ...s, ...patch } : s)) }));
  }, []);

  const addStop = useCallback(() => {
    const placeId = (pickPlace === MANUAL ? manualPlace : pickPlace).trim();
    if (!placeId) return;
    const stop: TourStop = {
      id: newId('stop'),
      placeId,
      headline: placeName(placeId).slice(0, TOUR_HEADLINE_MAX),
      talkTrack: '',
      facts: [],
      demo: null,
      dwellS: DEFAULT_DWELL_S,
      askToContinue: false,
    };
    setDraft((d) => ({ ...d, stops: [...d.stops, stop] }));
    if (pickPlace === MANUAL) setManualPlace('');
  }, [pickPlace, manualPlace, placeName]);

  /**
   * Speak a stop's talk track through the robot's own voice service, chunk by
   * chunk the way the runner says it — the KEPT chunks, so a track past the
   * speech cap sounds in the preview the way it will on the tour, and no chunk
   * exceeds the 500 characters `/voice/say` accepts.
   */
  const previewStop = useCallback(
    async (stop: TourStop) => {
      if (!draft.robotId) {
        setPreviewNote('Pick a robot to hear this on.');
        return;
      }
      const chunks = chunkTalkTrack(stop.talkTrack);
      if (chunks.length === 0) return;
      setPreviewingStopId(stop.id);
      setPreviewNote(null);
      try {
        for (const chunk of chunks) await voiceApi.say(draft.robotId, chunk, draft.language);
        const spokenChars = chunks.reduce((n, c) => n + c.length, 0);
        setPreviewNote(`Sent to the robot's speaker (${spokenChars} characters).`);
      } catch (err) {
        // The voice service is a sidecar and often simply not running; say so.
        setPreviewNote(`Could not play it: ${getErrorMessage(err, 'the voice service did not answer')}`);
      } finally {
        setPreviewingStopId(null);
      }
    },
    [draft.robotId, draft.language],
  );

  const toggleCollapsed = useCallback((id: string) => {
    setCollapsed((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const problems = useMemo(() => validateDraft(draft), [draft]);
  const errors = useMemo<FieldErrors>(() => (submitted ? fieldErrors(problems) : { byStop: {} }), [submitted, problems]);
  const invalidCount = submitted ? countErrors(errors) : 0;

  const handleSubmit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      setSubmitted(true);
      if (problems.length > 0) {
        requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
        return;
      }
      setSaving(true);
      setSaveError(null);
      const saved = await saveRoute(draftToInput(draft), route?.id ?? null);
      setSaving(false);
      if (saved) {
        onSaved(saved);
        return;
      }
      const message = useTourStore.getState().error ?? 'Saving failed';
      setSaveError(message);
      toast.error(route ? "Couldn't update tour" : "Couldn't create tour", { description: message });
    },
    [problems, saveRoute, draft, route, onSaved],
  );

  const placeOptions = places ?? [];
  const placesListId = placeOptions.length ? `tour-places-${draft.robotId}` : undefined;
  const robotLabel = robots.find((r) => r.id === draft.robotId)?.name ?? (draft.robotId || 'Any robot');
  const previewLegs = useMemo(() => draft.stops.map((s, i) => ({ index: i, label: s.headline || s.placeId || '?', status: 'route' as const })), [draft.stops]);
  const totalSeconds = useMemo(() => estimateTourSeconds(draft), [draft]);
  const stopsFull = draft.stops.length >= TOUR_STOPS_MAX;
  const placesMeta = draft.robotId
    ? placesStatus === 'loading'
      ? 'Reading places…'
      : placesStatus === 'error' || (placesStatus === 'ok' && placeOptions.length === 0)
        ? 'The robot lists no places — type a place id.'
        : `${placeOptions.length} places known`
    : 'Pick a robot to list its places, or type a place id.';

  return (
    <form ref={formRef} onSubmit={(e) => void handleSubmit(e)} noValidate className={className ? `flex flex-col gap-6 ${className}` : 'flex flex-col gap-6'} data-testid="tour-route-editor">
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3 xl:items-start">
        <div className="flex min-w-0 flex-col gap-6 xl:col-span-2">
          {/* Basics */}
          <Panel>
            <Panel.Header title="Basics" />
            <Panel.Body className="flex flex-col gap-4">
              {(invalidCount > 0 || saveError) && (
                <div className="rounded-control border border-line-subtle bg-inset px-3 py-2 text-[13px] text-signal-stopped" role="alert" data-testid="tour-editor-problems">
                  {saveError ?? `Fix ${invalidCount} field${invalidCount === 1 ? '' : 's'} before saving.`}
                  {errors.stops && <span className="block">{errors.stops}</span>}
                </div>
              )}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField label="Name" required error={errors.name}>
                  <Input data-testid="tour-route-name" value={draft.name} onChange={(e) => update({ name: e.target.value })} placeholder="ZeMA visitor tour" />
                </FormField>
                <FormField label="Robot" hint="Any robot: you choose one when you start the tour.">
                  <Select
                    data-testid="tour-route-robot"
                    value={draft.robotId}
                    onChange={(e) => update({ robotId: e.target.value })}
                    options={[{ value: '', label: 'Any robot' }, ...robots.map((r) => ({ value: r.id, label: r.name }))]}
                  />
                </FormField>
                {/* The visitor's own language still wins per turn; this is the language the AUTHORED sentences are in. */}
                <FormField label="Language" hint="A visitor who speaks the other language is answered in theirs.">
                  <Select
                    data-testid="tour-route-language"
                    value={draft.language}
                    onChange={(e) => update({ language: e.target.value as SpokenLanguage })}
                    options={SpokenLanguages.map((lang) => ({ value: lang, label: lang === 'de' ? 'German' : 'English' }))}
                  />
                </FormField>
                <FormField label="Greeting place" required error={errors.greetingPlaceId} hint="Where the robot waits for visitors and returns to.">
                  <Input data-testid="tour-greeting-place" className="font-mono" list={placesListId} value={draft.greetingPlaceId} placeholder="STAGING" onChange={(e) => update({ greetingPlaceId: e.target.value })} />
                </FormField>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Switch data-testid="tour-route-enabled" label="Armed" description="The robot may give this tour." checked={draft.enabled} onCheckedChange={(enabled) => update({ enabled })} />
                <Switch
                  data-testid="tour-route-autogreet"
                  label="Greet on sight"
                  description="Offer this tour to a visitor the robot sees."
                  checked={draft.autoGreet}
                  onCheckedChange={(autoGreet) => update({ autoGreet })}
                />
              </div>
              {/* An armed auto-greet on a disabled tour is silent; say so rather than let the operator believe the robot will speak. */}
              {draft.autoGreet && !draft.enabled && (
                <p className="text-[13px] text-ink-secondary" data-testid="tour-autogreet-inert">
                  The tour is off — the robot will not offer it to anyone.
                </p>
              )}
            </Panel.Body>
          </Panel>

          {/* Stops */}
          <Panel>
            <Panel.Header title="Stops" description={placesMeta} />
            <Panel.Body className="flex flex-col gap-4">
              {draft.stops.length === 0 && (
                <p className={errors.stops ? 'text-[13px] text-signal-stopped' : 'text-[13px] text-ink-tertiary'}>
                  {errors.stops ?? 'No stops yet. Add places in the order the robot should walk a visitor through them.'}
                </p>
              )}
              {draft.stops.length > 0 && (
                <ol className="relative flex flex-col gap-3 before:absolute before:bottom-6 before:left-3 before:top-6 before:w-px before:bg-line">
                  {draft.stops.map((stop, index) => (
                    <StopCard
                      key={stop.id}
                      stop={stop}
                      index={index}
                      count={draft.stops.length}
                      open={!stop.placeId.trim() || !stop.talkTrack.trim() || !collapsed.has(stop.id)}
                      errors={errors.byStop[index]}
                      placesListId={placesListId}
                      skills={skills}
                      previewing={previewingStopId === stop.id}
                      onToggle={() => toggleCollapsed(stop.id)}
                      onChange={(patch) => updateStop(index, patch)}
                      onMove={(delta) => setDraft((d) => ({ ...d, stops: moveStop(d.stops, index, delta) }))}
                      onRemove={() => setDraft((d) => ({ ...d, stops: d.stops.filter((_, i) => i !== index) }))}
                      onPreview={() => void previewStop(stop)}
                    />
                  ))}
                </ol>
              )}
              {previewNote && (
                <p className="text-[13px] text-ink-secondary" role="status" data-testid="tour-preview-note">
                  {previewNote}
                </p>
              )}
              <div className="flex flex-col gap-3 border-t border-line-subtle pt-4 sm:flex-row sm:items-end">
                <FormField label="Add stop at" className="min-w-0 flex-1" hint={stopsFull ? `A tour holds at most ${TOUR_STOPS_MAX} stops.` : undefined}>
                  <Select
                    data-testid="tour-place-pick"
                    value={pickPlace}
                    onChange={(e) => setPickPlace(e.target.value)}
                    placeholder="Choose a place…"
                    options={[...placeOptions.map((p) => ({ value: p.id, label: `${p.name}${p.placeType ? ` · ${p.placeType}` : ''}` })), { value: MANUAL, label: 'Type a place id…' }]}
                  />
                </FormField>
                {pickPlace === MANUAL && (
                  <FormField label="Place id" className="min-w-0 flex-1">
                    <Input
                      data-testid="tour-place-manual"
                      className="font-mono"
                      value={manualPlace}
                      placeholder="AISLE-1"
                      onChange={(e) => setManualPlace(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addStop();
                        }
                      }}
                    />
                  </FormField>
                )}
                <Button
                  variant="secondary"
                  leftIcon={<Plus className="h-4 w-4" strokeWidth={1.75} />}
                  data-testid="tour-stop-add"
                  disabled={stopsFull || !pickPlace || (pickPlace === MANUAL && !manualPlace.trim())}
                  onClick={addStop}
                >
                  Add stop
                </Button>
              </div>
              {placesListId && (
                <datalist id={placesListId}>
                  {placeOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </datalist>
              )}
            </Panel.Body>
          </Panel>

          {/* What the robot says */}
          <Panel>
            <Panel.Header title="What the robot says" description="Authored, said verbatim." />
            <Panel.Body className="flex flex-col gap-4">
              {/* Not an input on purpose: the robot appends its own AI disclosure to the welcome (EU AI Act Art. 50). */}
              <p className="text-[13px] text-ink-tertiary">
                The robot appends its AI disclosure to the welcome — that it is an AI-driven robot, that the conversation is processed by an AI, and that it records no
                video or audio. That sentence cannot be edited away here.
              </p>
              <FormField label="Welcome" required error={errors.greeting}>
                <Textarea data-testid="tour-greeting" rows={2} value={draft.greeting} placeholder="Hallo! Willkommen am ZeMA." onChange={(e) => update({ greeting: e.target.value })} />
              </FormField>
              <FormField label="Offer" required error={errors.offer}>
                <Textarea data-testid="tour-offer" rows={2} value={draft.offer} placeholder="Soll ich Ihnen alles zeigen? Das dauert etwa sechs Minuten." onChange={(e) => update({ offer: e.target.value })} />
              </FormField>
              <FormField label="Goodbye" required error={errors.farewell}>
                <Textarea data-testid="tour-farewell" rows={2} value={draft.farewell} placeholder="Danke für Ihren Besuch!" onChange={(e) => update({ farewell: e.target.value })} />
              </FormField>
              <FormField label="Site card" hint="Facts true anywhere on this tour — what this site is, who runs it." error={errors.siteCard}>
                <FactList
                  label="Site fact"
                  facts={draft.siteCard}
                  max={TOUR_SITE_CARD_MAX}
                  maxLength={TOUR_FACT_MAX}
                  placeholder="ZeMA is a research centre for mechatronics and automation in Saarbrücken."
                  onChange={(siteCard) => update({ siteCard })}
                  testId="tour-sitecard"
                />
              </FormField>
            </Panel.Body>
          </Panel>
        </div>

        {/* Preview — the stops as the same stepper the table and the visit draw. No map: a stop is placed by its place id. */}
        <Panel as="aside" className="xl:sticky xl:top-20">
          <Panel.Header title="Preview" />
          <Panel.Body className="flex flex-col gap-4">
            {previewLegs.length > 0 ? <RoutePath size="md" legs={previewLegs} /> : <p className="text-[13px] text-ink-tertiary">Add stops to see the path.</p>}
            <KeyValueList
              columns={1}
              items={[
                { label: 'Robot', value: robotLabel },
                { label: 'Stops', value: draft.stops.length },
                { label: 'Takes', value: <span data-testid="tour-preview-duration">{formatEstimate(totalSeconds)}</span> },
                { label: 'Language', value: draft.language === 'de' ? 'German' : 'English' },
                { label: 'Waits at', value: draft.greetingPlaceId.trim() || '—' },
                { label: 'Site facts', value: `${draft.siteCard.filter((f) => f.trim()).length} of ${TOUR_SITE_CARD_MAX}` },
                { label: 'Limits', value: `${TOUR_STOPS_MAX} stops · ${TOUR_FACTS_MAX} facts per stop · ${TOUR_TALK_TRACK_MAX} characters per talk track` },
              ]}
            />
          </Panel.Body>
        </Panel>
      </div>

      <div className="sticky bottom-0 z-10 -mx-4 flex justify-end gap-2 border-t border-line bg-canvas px-4 py-3 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" data-testid="tour-route-save" isLoading={saving} disabled={saving}>
          {route ? 'Save changes' : 'Create tour'}
        </Button>
      </div>
    </form>
  );
});

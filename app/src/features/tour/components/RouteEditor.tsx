/**
 * @file RouteEditor.tsx
 * @description Create/edit a tour: name, robot, language, the greeting place,
 *              the three authored sentences (greeting, offer, farewell), the
 *              site card, and the ordered stops — each with a talk track (live
 *              character AND estimated-seconds counter, computed exactly as the
 *              robot chunks it), the facts it may answer from, and an optional
 *              VLA demo. Ops form on the left, sticky preview rail + save bar on
 *              the right; the stops are a vertical stepper of collapsible cards.
 * @feature tour
 */

import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { cn } from '@/shared/utils/cn';
import { Button } from '@/shared/components/ui/Button';
import { getErrorMessage } from '@/shared/utils/error';
import { voiceApi } from '@/features/robots/api/voiceApi';
import {
  LEG_NODE,
  PATROL_FADE_IN,
  PATROL_FOCUS,
  PATROL_MICRO,
  PATROL_MONO,
  PATROL_MOTION,
  PATROL_PANEL,
  PATROL_STICKY_RAIL,
  RoutePath,
  SectionHeader,
  StatusDot,
} from '@/features/patrol/components/patrolUi';
import type {
  SpokenLanguage,
  TourPlace,
  TourRoute,
  TourRouteInput,
  TourSkillOption,
  TourStop,
} from '../types/tour.types';
import {
  SpokenLanguages,
  TOUR_DWELL_MAX_S,
  TOUR_FACTS_MAX,
  TOUR_FACT_MAX,
  TOUR_HEADLINE_MAX,
  TOUR_SITE_CARD_MAX,
  TOUR_STOPS_MAX,
  TOUR_TALK_TRACK_MAX,
} from '../types/tour.types';
import { useTourStore, selectPlacesForRobot, selectSkills } from '../store/tourStore';
import {
  TOUR_STOP_SPEECH_CAP_S,
  chunkTalkTrack,
  estimateTourSeconds,
  formatEstimate,
  stopSpeechSeconds,
  talkTrackTruncated,
} from '../utils/tourFormat';

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
  onDelete?: (route: TourRoute) => void;
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
// HELPERS
// ============================================================================

const MANUAL = '__manual__';
/** Default dwell, mirroring `AGENT_TOUR_DWELL_S` on the robot. */
const DEFAULT_DWELL_S = 12;
/** Default demo length when the skill library reports no timeout. */
const DEFAULT_DEMO_SECONDS = 30;

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

const INPUT = cn(
  'glass-subtle w-full min-w-0 px-2.5 py-1.5 text-sm text-theme-primary rounded-brand border border-glass-subtle',
  'focus:outline-none focus:ring-2 focus:ring-cobalt-500/40 focus:border-cobalt-500/40 disabled:opacity-50',
  PATROL_MOTION
);
const LABEL = 'block text-xs font-medium text-theme-secondary mb-1';
const ICON_BTN = cn(
  'size-7 glass-subtle rounded-brand inline-flex items-center justify-center text-xs leading-none',
  'hover:bg-theme-hover disabled:opacity-40 disabled:hover:bg-transparent',
  PATROL_MOTION,
  PATROL_FOCUS
);
const CHIP = cn(PATROL_MONO, 'glass-subtle rounded px-1.5 py-px text-[11px]');
const NODE = 'relative z-10 shrink-0 w-6 h-6 rounded-full inline-flex items-center justify-center text-[11px] font-semibold tabular-nums';
const STEPPER_LINE = 'relative before:absolute before:left-[11px] before:top-3 before:bottom-3 before:w-px before:bg-[var(--glass-border-highlight)]';

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

interface FactListProps {
  /** Accessible prefix for every row ("Stop 2 fact"). */
  label: string;
  facts: string[];
  max: number;
  maxLength: number;
  placeholder?: string;
  onChange: (facts: string[]) => void;
  testId: string;
}

/**
 * The editable fact list, shared by the site card and every stop. One component
 * for both because they are the same thing at two scopes: the ONLY ground the
 * robot may answer from. Adding is blocked at `max` rather than silently
 * truncated later — the operator has to see which fact did not fit.
 */
const FactList = memo(function FactList({ label, facts, max, maxLength, placeholder, onChange, testId }: FactListProps) {
  const full = facts.length >= max;
  return (
    <div className="flex flex-col gap-1.5 min-w-0" data-testid={testId}>
      {facts.map((fact, i) => (
        <div key={i} className="flex items-start gap-1.5 min-w-0">
          <input
            className={cn(INPUT, fact.length > maxLength && 'border-red-500/50')}
            aria-label={`${label} ${i + 1}`}
            data-testid={`${testId}-input`}
            maxLength={maxLength}
            value={fact}
            placeholder={placeholder}
            onChange={(e) => onChange(facts.map((f, j) => (j === i ? e.target.value : f)))}
          />
          <button
            type="button"
            className={cn(ICON_BTN, 'mt-0.5 text-red-600 dark:text-red-400 hover:bg-red-500/10')}
            aria-label={`Remove ${label.toLowerCase()} ${i + 1}`}
            onClick={() => onChange(facts.filter((_, j) => j !== i))}
          >
            ✕
          </button>
        </div>
      ))}
      <div className="flex items-center gap-2 flex-wrap">
        <Button size="sm" variant="ghost" className="min-h-9" data-testid={`${testId}-add`} disabled={full} onClick={() => onChange([...facts, ''])}>
          Add fact
        </Button>
        <span className={cn(PATROL_MONO, full && 'text-amber-700 dark:text-amber-400')}>
          {facts.length}/{max}
        </span>
      </div>
    </div>
  );
});

function Fact({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <>
      <dt className={cn(PATROL_MICRO, 'pt-0.5')}>{label}</dt>
      <dd className={cn(PATROL_MONO, 'min-w-0 break-words')}>{children}</dd>
    </>
  );
}

/**
 * The counter under a talk track. It reports what the ROBOT will do with the
 * text — how many `present` blocks it becomes and how long they take — using the
 * chunking mirrored from `host.ts`. A track whose tail falls past the per-stop
 * speech cap says so: silently dropping the last sentences of an authored
 * paragraph is the kind of surprise that only shows up in front of a visitor.
 */
const TalkTrackMeter = memo(function TalkTrackMeter({ talkTrack, stopNumber }: { talkTrack: string; stopNumber: number }) {
  const chunks = chunkTalkTrack(talkTrack);
  const seconds = stopSpeechSeconds(talkTrack);
  const truncated = talkTrackTruncated(talkTrack);
  const overLength = talkTrack.length > TOUR_TALK_TRACK_MAX;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0" aria-live="polite" data-testid="tour-talktrack-meter">
      <span className={cn(PATROL_MONO, overLength && 'text-red-600 dark:text-red-400')} data-testid="tour-talktrack-chars">
        {talkTrack.length}/{TOUR_TALK_TRACK_MAX} chars
      </span>
      <span className={cn(PATROL_MONO, 'text-theme-secondary')} data-testid="tour-talktrack-seconds">
        ≈ {seconds.toFixed(1)} s in {chunks.length} {chunks.length === 1 ? 'part' : 'parts'}
      </span>
      <span className="sr-only">{`Stop ${stopNumber} talk track: about ${seconds.toFixed(1)} seconds in ${chunks.length} parts.`}</span>
      {truncated && (
        <span className="text-[11px] text-amber-700 dark:text-amber-400 break-words" data-testid="tour-talktrack-truncated">
          Past the {TOUR_STOP_SPEECH_CAP_S} s cap — the robot stops after {chunks.length} {chunks.length === 1 ? 'part' : 'parts'} and the rest is not said.
        </span>
      )}
    </div>
  );
});

// ============================================================================
// COMPONENT
// ============================================================================

export const RouteEditor = memo(function RouteEditor({
  route,
  robots,
  defaultRobotId,
  onSaved,
  onCancel,
  onDelete,
  className,
}: RouteEditorProps) {
  const [draft, setDraft] = useState<Draft>(() => draftFromRoute(route, defaultRobotId));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pickPlace, setPickPlace] = useState<string>('');
  /** Result of the last "Hear it" — one line, shared by every stop. */
  const [previewNote, setPreviewNote] = useState<string | null>(null);
  const [previewingStopId, setPreviewingStopId] = useState<string | null>(null);
  const [manualPlace, setManualPlace] = useState('');
  /** Stop ids whose details are folded away (inputs stay mounted). */
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(route?.stops.map((s) => s.id) ?? []));

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
    // A new stop opens: it has no talk track yet, which is the whole job.
    setCollapsed((s) => {
      const next = new Set(s);
      next.delete(stop.id);
      return next;
    });
    if (pickPlace === MANUAL) setManualPlace('');
  }, [pickPlace, manualPlace, placeName]);

  /**
   * Speak a stop's talk track through the robot's own voice service, exactly as
   * a visitor would hear it: the KEPT chunks, joined — not the raw textarea, so
   * a track past the speech cap sounds in the preview the way it will sound on
   * the tour.
   */
  const previewStop = useCallback(
    async (stop: TourStop) => {
      if (!draft.robotId) {
        setPreviewNote('Pick a robot to hear this on.');
        return;
      }
      // Chunk by chunk, in order, the way the runner says it at the stop — not
      // joined back into one string. `/voice/say` rejects anything over 500
      // characters while a talk track may be TOUR_TALK_TRACK_MAX (600), so the
      // joined form made the preview unreachable for content this very editor
      // reports as within cap.
      const chunks = chunkTalkTrack(stop.talkTrack);
      if (chunks.length === 0) return;
      setPreviewingStopId(stop.id);
      setPreviewNote(null);
      try {
        for (const chunk of chunks) {
          await voiceApi.say(draft.robotId, chunk, draft.language);
        }
        const spokenChars = chunks.reduce((n, c) => n + c.length, 0);
        setPreviewNote(`Sent to the robot's speaker (${spokenChars} characters).`);
      } catch (err) {
        // The voice service is a sidecar and is often simply not running; say
        // so instead of leaving the author waiting for a sound that never comes.
        setPreviewNote(`Could not play it: ${getErrorMessage(err, 'the voice service did not answer')}`);
      } finally {
        setPreviewingStopId(null);
      }
    },
    [draft.robotId, draft.language]
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

  const handleSave = useCallback(async () => {
    if (problems.length > 0) return;
    setSaving(true);
    setSaveError(null);
    const saved = await saveRoute(draftToInput(draft), route?.id ?? null);
    setSaving(false);
    if (saved) onSaved(saved);
    else setSaveError(useTourStore.getState().error ?? 'Saving failed');
  }, [problems, saveRoute, draft, route?.id, onSaved]);

  const placeOptions: TourPlace[] = places ?? [];
  const robotLabel = robots.find((r) => r.id === draft.robotId)?.name ?? (draft.robotId || 'any robot');
  const previewLegs = useMemo(
    () => draft.stops.map((s, i) => ({ index: i, label: s.headline || s.placeId || '?', status: 'route' as const })),
    [draft.stops]
  );
  const totalSeconds = useMemo(() => estimateTourSeconds(draft), [draft]);
  const allCollapsed = draft.stops.length > 0 && draft.stops.every((s) => collapsed.has(s.id));
  const stopsFull = draft.stops.length >= TOUR_STOPS_MAX;

  return (
    <div className={cn('flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start min-w-0', className)} data-testid="tour-route-editor">
      {/* ------------------------------------------------------------ left: form */}
      <div className="flex flex-col gap-4 min-w-0">
        {/* Tour */}
        <section className={PATROL_PANEL}>
          <SectionHeader as="h3" title="Tour" className="mb-3" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="min-w-0">
              <label className={LABEL} htmlFor="tour-route-name">
                Tour name
              </label>
              <input
                id="tour-route-name"
                data-testid="tour-route-name"
                className={INPUT}
                value={draft.name}
                onChange={(e) => update({ name: e.target.value })}
                placeholder="ZeMA visitor tour"
              />
            </div>
            <div className="min-w-0">
              <label className={LABEL} htmlFor="tour-route-robot">
                Robot
              </label>
              <select
                id="tour-route-robot"
                data-testid="tour-route-robot"
                className={cn(INPUT, 'truncate')}
                value={draft.robotId}
                onChange={(e) => update({ robotId: e.target.value })}
              >
                <option value="">Any robot (choose at start)</option>
                {robots.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-0">
              <label className={LABEL} htmlFor="tour-route-language">
                Language
              </label>
              <select
                id="tour-route-language"
                data-testid="tour-route-language"
                className={INPUT}
                value={draft.language}
                onChange={(e) => update({ language: e.target.value as SpokenLanguage })}
              >
                {SpokenLanguages.map((lang) => (
                  <option key={lang} value={lang}>
                    {lang === 'de' ? 'German' : 'English'}
                  </option>
                ))}
              </select>
              {/* The visitor's own language still wins per turn; this is only
                  the language the AUTHORED sentences are written in. */}
              <p className="card-meta text-[11px] mt-1">The prepared sentences are in this language. A visitor who speaks the other one is answered in theirs.</p>
            </div>
            <div className="min-w-0">
              <label className={LABEL} htmlFor="tour-greeting-place">
                Greeting place (waits and returns here)
              </label>
              <input
                id="tour-greeting-place"
                data-testid="tour-greeting-place"
                className={cn(INPUT, 'font-mono text-xs')}
                list={placeOptions.length ? `tour-places-${draft.robotId}` : undefined}
                value={draft.greetingPlaceId}
                placeholder="STAGING"
                onChange={(e) => update({ greetingPlaceId: e.target.value })}
              />
            </div>
          </div>
        </section>

        {/* What the robot says */}
        <section className={PATROL_PANEL}>
          <SectionHeader
            as="h3"
            title="What the robot says"
            className="mb-3"
            meta="authored, said verbatim"
          />
          {/* The disclosure is not an input on purpose: the robot appends its
              own AI-disclosure sentence to the greeting and no operator can
              remove it (EU AI Act Art. 50). */}
          <p className="card-meta text-xs mb-3">
            The robot appends its AI disclosure to the welcome — that it is an AI-driven robot, that the conversation is processed by an AI, and that it records
            no video or audio. That sentence cannot be edited away here.
          </p>
          <div className="flex flex-col gap-3">
            <div className="min-w-0">
              <label className={LABEL} htmlFor="tour-greeting">
                Welcome
              </label>
              <textarea
                id="tour-greeting"
                data-testid="tour-greeting"
                className={cn(INPUT, 'min-h-[3rem]')}
                rows={2}
                value={draft.greeting}
                placeholder="Hallo! Willkommen am ZeMA."
                onChange={(e) => update({ greeting: e.target.value })}
              />
            </div>
            <div className="min-w-0">
              <label className={LABEL} htmlFor="tour-offer">
                Offer
              </label>
              <textarea
                id="tour-offer"
                data-testid="tour-offer"
                className={cn(INPUT, 'min-h-[3rem]')}
                rows={2}
                value={draft.offer}
                placeholder="Soll ich Ihnen alles zeigen? Das dauert etwa sechs Minuten."
                onChange={(e) => update({ offer: e.target.value })}
              />
            </div>
            <div className="min-w-0">
              <label className={LABEL} htmlFor="tour-farewell">
                Goodbye
              </label>
              <textarea
                id="tour-farewell"
                data-testid="tour-farewell"
                className={cn(INPUT, 'min-h-[3rem]')}
                rows={2}
                value={draft.farewell}
                placeholder="Danke für Ihren Besuch!"
                onChange={(e) => update({ farewell: e.target.value })}
              />
            </div>
            <div className="min-w-0">
              <span className={LABEL}>Site card — facts true anywhere on this tour</span>
              <p className="card-meta text-[11px] mb-1.5">What this site is, who runs it. The robot may answer from these at every stop.</p>
              <FactList
                label="Site fact"
                facts={draft.siteCard}
                max={TOUR_SITE_CARD_MAX}
                maxLength={TOUR_FACT_MAX}
                placeholder="ZeMA is a research centre for mechatronics and automation in Saarbrücken."
                onChange={(siteCard) => update({ siteCard })}
                testId="tour-sitecard"
              />
            </div>
          </div>
        </section>

        {/* Stops */}
        <section className={PATROL_PANEL}>
          <SectionHeader
            as="h3"
            title="Stops"
            count={draft.stops.length}
            className="mb-3"
            meta={
              draft.robotId
                ? placesStatus === 'loading'
                  ? 'reading places…'
                  : placesStatus === 'error' || (placesStatus === 'ok' && placeOptions.length === 0)
                    ? 'no places from the robot — type a place id'
                    : `${placeOptions.length} places known`
                : 'pick a robot to list its places'
            }
            actions={
              draft.stops.length > 1 ? (
                <button
                  type="button"
                  className={cn('text-[11px] text-theme-tertiary hover:text-theme-primary rounded px-1', PATROL_MOTION, PATROL_FOCUS)}
                  onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(draft.stops.map((s) => s.id)))}
                >
                  {allCollapsed ? 'Expand all' : 'Collapse all'}
                </button>
              ) : undefined
            }
          />

          {draft.stops.length === 0 && (
            <p className="card-meta text-xs mb-3">No stops yet. Add places below in the order the robot should walk a visitor through them.</p>
          )}

          <ol className={cn('flex flex-col gap-2', STEPPER_LINE)}>
            {draft.stops.map((stop, index) => {
              const missing = !stop.placeId.trim() || !stop.talkTrack.trim();
              const isOpen = missing || !collapsed.has(stop.id);
              const detailsId = `tour-stop-details-${stop.id}`;
              const chunkCount = chunkTalkTrack(stop.talkTrack).length;
              return (
                <li key={stop.id} className={cn('flex items-start gap-3 min-w-0', PATROL_FADE_IN)} data-testid="tour-stop" data-index={index}>
                  <span className={cn(NODE, LEG_NODE.route, missing && 'ring-2 ring-amber-500/50')} aria-hidden="true">
                    {index + 1}
                  </span>

                  <div
                    className={cn(
                      'glass-subtle rounded-brand p-3 flex-1 min-w-0 flex flex-col gap-2 border border-transparent',
                      PATROL_MOTION,
                      isOpen && 'border-glass-highlight',
                      missing && 'border-l-[3px] border-l-amber-500'
                    )}
                  >
                    {/* summary line + rail */}
                    <div className="flex items-start gap-2 min-w-0">
                      <button
                        type="button"
                        className={cn('flex-1 min-w-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-left rounded', PATROL_FOCUS, !missing && 'cursor-pointer')}
                        aria-expanded={isOpen}
                        aria-controls={detailsId}
                        aria-label={`Stop ${index + 1} details`}
                        disabled={missing}
                        onClick={() => toggleCollapsed(stop.id)}
                      >
                        <span className="text-sm font-medium text-theme-primary truncate max-w-full">
                          {stop.headline || stop.placeId || <span className="text-theme-muted">unnamed</span>}
                        </span>
                        <span className={CHIP}>{stop.placeId || '—'}</span>
                        <span className={CHIP}>
                          {chunkCount} {chunkCount === 1 ? 'part' : 'parts'}
                        </span>
                        {stop.facts.filter((f) => f.trim()).length > 0 && <span className={CHIP}>{stop.facts.filter((f) => f.trim()).length} facts</span>}
                        {stop.demo && <span className={cn(CHIP, 'text-cobalt-700 dark:text-cobalt-300')}>demo</span>}
                        <span className={cn('ml-auto text-theme-tertiary text-[10px]', PATROL_MOTION, isOpen && 'rotate-180')} aria-hidden="true">
                          ▼
                        </span>
                      </button>
                      <div className={cn('shrink-0 flex gap-1', isOpen ? 'flex-col sm:flex-row' : 'flex-row')}>
                        <button
                          type="button"
                          className={ICON_BTN}
                          aria-label={`Move stop ${index + 1} up`}
                          data-testid="tour-stop-up"
                          disabled={index === 0}
                          onClick={() => setDraft((d) => ({ ...d, stops: moveStop(d.stops, index, -1) }))}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className={ICON_BTN}
                          aria-label={`Move stop ${index + 1} down`}
                          data-testid="tour-stop-down"
                          disabled={index === draft.stops.length - 1}
                          onClick={() => setDraft((d) => ({ ...d, stops: moveStop(d.stops, index, 1) }))}
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          className={cn(ICON_BTN, 'text-red-600 dark:text-red-400 hover:bg-red-500/10')}
                          aria-label={`Remove stop ${index + 1}`}
                          data-testid="tour-stop-remove"
                          onClick={() => setDraft((d) => ({ ...d, stops: d.stops.filter((_, i) => i !== index) }))}
                        >
                          ✕
                        </button>
                      </div>
                    </div>

                    {/* details — folded with `hidden`, never unmounted */}
                    <div id={detailsId} className={cn('flex flex-col gap-2 min-w-0', !isOpen && 'hidden')}>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div className="min-w-0">
                          <label className={LABEL}>Headline</label>
                          <input
                            className={INPUT}
                            aria-label={`Stop ${index + 1} headline`}
                            data-testid="tour-stop-headline"
                            maxLength={TOUR_HEADLINE_MAX}
                            value={stop.headline}
                            onChange={(e) => updateStop(index, { headline: e.target.value })}
                          />
                          <span className={cn(PATROL_MONO, 'mt-1 inline-block')}>
                            {stop.headline.length}/{TOUR_HEADLINE_MAX}
                          </span>
                        </div>
                        <div className="min-w-0">
                          <label className={LABEL}>Place id</label>
                          <input
                            className={cn(INPUT, 'font-mono text-xs')}
                            aria-label={`Stop ${index + 1} place id`}
                            aria-invalid={!stop.placeId.trim() || undefined}
                            list={placeOptions.length ? `tour-places-${draft.robotId}` : undefined}
                            value={stop.placeId}
                            onChange={(e) => updateStop(index, { placeId: e.target.value })}
                          />
                        </div>
                      </div>

                      <div className="min-w-0">
                        <label className={LABEL}>Talk track (said verbatim, in ≤2-sentence parts)</label>
                        <textarea
                          className={cn(INPUT, 'min-h-[5rem]')}
                          rows={4}
                          aria-label={`Stop ${index + 1} talk track`}
                          data-testid="tour-stop-talktrack"
                          maxLength={TOUR_TALK_TRACK_MAX}
                          value={stop.talkTrack}
                          placeholder="Hier ist meine Arbeitsstation. Ich lege einen Apfel auf den Teller — mit einem VLA-Modell, das wir selbst trainiert haben."
                          onChange={(e) => updateStop(index, { talkTrack: e.target.value })}
                        />
                        <div className="flex flex-wrap items-center gap-2 min-w-0">
                          <TalkTrackMeter talkTrack={stop.talkTrack} stopNumber={index + 1} />
                          <Button
                            size="sm"
                            variant="ghost"
                            className="min-h-9 ml-auto"
                            data-testid="tour-stop-preview"
                            aria-label={`Hear stop ${index + 1}`}
                            disabled={!stop.talkTrack.trim() || previewingStopId === stop.id}
                            isLoading={previewingStopId === stop.id}
                            title={draft.robotId ? 'Say it through the robot speaker' : 'Pick a robot first'}
                            onClick={() => void previewStop(stop)}
                          >
                            Hear it
                          </Button>
                        </div>
                      </div>

                      <div className="min-w-0">
                        <label className={LABEL}>Facts — the only ground for answering a question here</label>
                        <FactList
                          label={`Stop ${index + 1} fact`}
                          facts={stop.facts}
                          max={TOUR_FACTS_MAX}
                          maxLength={TOUR_FACT_MAX}
                          placeholder="The model was trained on 120 demonstrations recorded on this robot."
                          onChange={(facts) => updateStop(index, { facts })}
                          testId="tour-stop-facts"
                        />
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-end">
                        <div className="min-w-0">
                          <label className={LABEL}>Dwell (s)</label>
                          {/* Capped at what the robot's `wait` block actually
                              honours (TOUR_DWELL_MAX_S): a longer number here
                              would be saved, shown in the duration estimate,
                              and then silently clamped on the robot. */}
                          <input
                            type="number"
                            min={0}
                            max={TOUR_DWELL_MAX_S}
                            className={cn(INPUT, 'font-mono text-xs')}
                            aria-label={`Stop ${index + 1} dwell seconds`}
                            value={stop.dwellS}
                            onChange={(e) =>
                              updateStop(index, {
                                dwellS: Math.max(0, Math.min(TOUR_DWELL_MAX_S, Number(e.target.value) || 0)),
                              })
                            }
                          />
                        </div>
                        <label className="col-span-2 inline-flex items-center gap-2 text-xs text-theme-secondary cursor-pointer select-none min-w-0">
                          <input
                            type="checkbox"
                            className="accent-cobalt-500"
                            aria-label={`Stop ${index + 1} ask to continue`}
                            checked={stop.askToContinue}
                            onChange={(e) => updateStop(index, { askToContinue: e.target.checked })}
                          />
                          Ask "shall we go on?" before walking to the next stop
                        </label>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_7rem] gap-2 items-end">
                        <div className="min-w-0">
                          <label className={LABEL}>Demo skill (optional)</label>
                          <select
                            className={cn(INPUT, 'truncate')}
                            aria-label={`Stop ${index + 1} demo skill`}
                            data-testid="tour-stop-demo"
                            value={stop.demo?.skillId ?? ''}
                            onChange={(e) => {
                              const chosen = e.target.value;
                              // Re-selecting the stop's own unknown skill must
                              // not wipe it: it is not in `skills`, so `find`
                              // returns undefined and the branch below would
                              // clear a demo the operator did not touch.
                              if (chosen && stop.demo && chosen === stop.demo.skillId) return;
                              const skill: TourSkillOption | undefined = skills.find((s) => s.id === chosen);
                              updateStop(index, {
                                demo: skill
                                  ? {
                                      skillId: skill.id,
                                      skillName: skill.name,
                                      modelVersionId: skill.linkedModelVersionId ?? null,
                                      // Seeded from the skill's own timeout so the
                                      // route's duration estimate starts honest.
                                      expectSeconds: skill.timeout ?? DEFAULT_DEMO_SECONDS,
                                    }
                                  : null,
                              });
                            }}
                          >
                            <option value="">No demo</option>
                            {/* A demo the skill library does not (or does not
                                yet) list — a seeded route, a skill deleted
                                since, or a library that failed to load. Without
                                its own option the select falls back to "No
                                demo", which tells the operator the stop has no
                                demonstration while the draft still carries it
                                and saves it straight back. Show it, and say
                                that it is not in the library. */}
                            {stop.demo && !skills.some((s) => s.id === stop.demo?.skillId) && (
                              <option value={stop.demo.skillId}>
                                {stop.demo.skillName || stop.demo.skillId} · not in the skill library
                              </option>
                            )}
                            {skills.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name}
                                {s.version ? ` · ${s.version}` : ''}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="min-w-0">
                          <label className={LABEL}>Takes (s)</label>
                          <input
                            type="number"
                            min={0}
                            className={cn(INPUT, 'font-mono text-xs')}
                            aria-label={`Stop ${index + 1} demo seconds`}
                            disabled={!stop.demo}
                            value={stop.demo?.expectSeconds ?? 0}
                            onChange={(e) => updateStop(index, { demo: stop.demo ? { ...stop.demo, expectSeconds: Number(e.target.value) } : null })}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}

            {/* ghost node: add the next stop */}
            <li className="flex items-start gap-3 min-w-0">
              <span className={cn(NODE, 'border border-dashed border-glass-highlight text-theme-tertiary bg-[var(--glass-bg)]')} aria-hidden="true">
                +
              </span>
              <div className="flex-1 min-w-0 border border-dashed border-glass-highlight rounded-brand p-3">
                <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
                  <div className="flex-1 min-w-0">
                    <label className={LABEL} htmlFor="tour-place-pick">
                      Add stop at
                    </label>
                    <select
                      id="tour-place-pick"
                      data-testid="tour-place-pick"
                      className={cn(INPUT, 'truncate')}
                      value={pickPlace}
                      onChange={(e) => setPickPlace(e.target.value)}
                    >
                      <option value="">Choose a place…</option>
                      {placeOptions.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                          {p.placeType ? ` · ${p.placeType}` : ''}
                        </option>
                      ))}
                      <option value={MANUAL}>Type a place id…</option>
                    </select>
                  </div>
                  {pickPlace === MANUAL && (
                    <div className="flex-1 min-w-0">
                      <label className={LABEL} htmlFor="tour-place-manual">
                        Place id
                      </label>
                      <input
                        id="tour-place-manual"
                        data-testid="tour-place-manual"
                        className={cn(INPUT, 'font-mono text-xs')}
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
                    </div>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="min-h-9"
                    data-testid="tour-stop-add"
                    disabled={stopsFull || !pickPlace || (pickPlace === MANUAL && !manualPlace.trim())}
                    title={stopsFull ? `A tour holds at most ${TOUR_STOPS_MAX} stops` : undefined}
                    onClick={addStop}
                  >
                    Add stop
                  </Button>
                </div>
                {stopsFull && <p className="card-meta text-[11px] mt-1.5">A tour holds at most {TOUR_STOPS_MAX} stops.</p>}
              </div>
            </li>
          </ol>

          {placeOptions.length > 0 && (
            <datalist id={`tour-places-${draft.robotId}`}>
              {placeOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </datalist>
          )}
        </section>
      </div>

      {/* ------------------------------------------------------ right: preview */}
      <aside className={cn(PATROL_STICKY_RAIL, 'flex flex-col gap-4 min-w-0')}>
        <section className={PATROL_PANEL}>
          <SectionHeader
            as="h3"
            title="Preview"
            className="mb-3"
            actions={
              <span className={cn(PATROL_MONO, 'inline-flex items-center gap-1.5')}>
                <StatusDot tone={draft.enabled ? 'accent' : 'neutral'} />
                {draft.enabled ? 'enabled' : 'disabled'}
              </span>
            }
          />
          {/* The stops as the same stepper the cards and the run detail draw. A
              map preview is deliberately not here: the robot places a stop by
              its place id, and a route with no run behind it has no poses to
              draw honestly. */}
          {previewLegs.length > 0 ? <RoutePath size="md" legs={previewLegs} className="mb-3" /> : <p className="card-meta text-xs mb-3">Add stops to see the path.</p>}
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5">
            <Fact label="Robot">{robotLabel}</Fact>
            <Fact label="Stops">{draft.stops.length}</Fact>
            <Fact label="Takes">
              <span data-testid="tour-preview-duration">{formatEstimate(totalSeconds)}</span>
            </Fact>
            <Fact label="Language">{draft.language === 'de' ? 'German' : 'English'}</Fact>
            <Fact label="Waits at">{draft.greetingPlaceId.trim() || '—'}</Fact>
            <Fact label="Site facts">{draft.siteCard.filter((f) => f.trim()).length}</Fact>
          </dl>

          <div className="mt-3 flex flex-col gap-2 pt-3 border-t border-glass-subtle">
            <label className="inline-flex items-center gap-2.5 text-sm text-theme-secondary cursor-pointer select-none">
              <input
                type="checkbox"
                className="sr-only peer"
                data-testid="tour-route-enabled"
                checked={draft.enabled}
                onChange={(e) => update({ enabled: e.target.checked })}
              />
              <span
                className={cn(
                  'relative inline-block w-9 h-5 rounded-full shrink-0 bg-surface-light-300 dark:bg-surface-500',
                  'peer-checked:bg-cobalt-500 peer-focus-visible:ring-2 peer-focus-visible:ring-cobalt-500/40',
                  'after:absolute after:top-0.5 after:left-0.5 after:w-4 after:h-4 after:rounded-full after:bg-white after:shadow-sm',
                  'after:transition-transform after:duration-200 peer-checked:after:translate-x-4',
                  PATROL_MOTION
                )}
                aria-hidden="true"
              />
              Enabled
            </label>
            <label className="inline-flex items-center gap-2.5 text-sm text-theme-secondary cursor-pointer select-none">
              <input
                type="checkbox"
                className="sr-only peer"
                data-testid="tour-route-autogreet"
                checked={draft.autoGreet}
                onChange={(e) => update({ autoGreet: e.target.checked })}
              />
              <span
                className={cn(
                  'relative inline-block w-9 h-5 rounded-full shrink-0 bg-surface-light-300 dark:bg-surface-500',
                  'peer-checked:bg-cobalt-500 peer-focus-visible:ring-2 peer-focus-visible:ring-cobalt-500/40',
                  'after:absolute after:top-0.5 after:left-0.5 after:w-4 after:h-4 after:rounded-full after:bg-white after:shadow-sm',
                  'after:transition-transform after:duration-200 peer-checked:after:translate-x-4',
                  PATROL_MOTION
                )}
                aria-hidden="true"
              />
              Offer this tour to a visitor it sees
            </label>
            {/* An armed auto-greet on a disabled tour is silent; say so rather
                than letting the operator believe the robot will speak. */}
            {draft.autoGreet && !draft.enabled && (
              <p className="text-[11px] text-amber-700 dark:text-amber-400" data-testid="tour-autogreet-inert">
                The tour is disabled — the robot will not offer it to anyone.
              </p>
            )}
          </div>
        </section>

        {/* save bar — fixed to the bottom on small screens */}
        <div
          className={cn(
            'fixed bottom-0 inset-x-0 z-20 glass-elevated rounded-none border-t border-glass p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]',
            'lg:static lg:z-auto lg:rounded-brand-lg lg:border-t-0 lg:p-4',
            'flex flex-col gap-2 min-w-0'
          )}
        >
          {previewNote && (
            <p className="text-xs text-theme-secondary break-words" role="status" data-testid="tour-preview-note">
              {previewNote}
            </p>
          )}
          {(problems.length > 0 || saveError) && (
            <ul className="text-xs text-amber-700 dark:text-amber-400 list-disc pl-4 max-h-24 overflow-y-auto" role="status" data-testid="tour-editor-problems">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
              {saveError && <li className="text-red-600 dark:text-red-400">{saveError}</li>}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-2 justify-end">
            {route && onDelete && (
              <Button
                size="sm"
                variant="ghost"
                className="mr-auto min-h-9 text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300"
                data-testid="tour-route-delete"
                onClick={() => onDelete(route)}
              >
                Delete tour
              </Button>
            )}
            {onCancel && (
              <Button size="sm" variant="ghost" className="min-h-9" onClick={onCancel}>
                Cancel
              </Button>
            )}
            <Button
              size="sm"
              variant="primary"
              className={cn('min-h-9', PATROL_MOTION, 'hover:shadow-[0_0_20px_-4px_color-mix(in_srgb,var(--color-primary)_45%,transparent)]')}
              data-testid="tour-route-save"
              isLoading={saving}
              disabled={saving || problems.length > 0}
              onClick={() => void handleSave()}
            >
              {route ? 'Save tour' : 'Create tour'}
            </Button>
          </div>
        </div>
      </aside>
    </div>
  );
});

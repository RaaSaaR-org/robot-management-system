/**
 * @file StopCard.tsx
 * @description One stop in the tour editor's stepper: headline and place,
 *              then (unfolded) the talk track with its meter and "Hear it", the
 *              facts, dwell, ask-to-continue and an optional VLA demo. Reorder
 *              and remove with icon buttons; no confirm, because the draft is
 *              not saved yet. The twin of the patrol CheckpointCard.
 * @feature tour
 */

import { memo } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, Trash2, Volume2 } from 'lucide-react';
import { Button, Checkbox, FormField, Input, Panel, Select, Textarea } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import type { TourSkillOption, TourStop } from '../types/tour.types';
import { TOUR_DWELL_MAX_S, TOUR_FACTS_MAX, TOUR_FACT_MAX, TOUR_HEADLINE_MAX, TOUR_TALK_TRACK_MAX } from '../types/tour.types';
import { chunkTalkTrack } from '../utils/tourFormat';
import { FactList } from './FactList';
import { TalkTrackMeter } from './TalkTrackMeter';

/** Default demo length when the skill library reports no timeout. */
const DEFAULT_DEMO_SECONDS = 30;

export interface StopErrors {
  place?: string;
  headline?: string;
  talkTrack?: string;
  facts?: string;
  demo?: string;
}

export interface StopCardProps {
  stop: TourStop;
  index: number;
  count: number;
  open: boolean;
  errors?: StopErrors;
  placesListId?: string;
  skills: TourSkillOption[];
  previewing: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<TourStop>) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
  onPreview: () => void;
}

export const StopCard = memo(function StopCard({
  stop,
  index,
  count,
  open: openProp,
  errors = {},
  placesListId,
  skills,
  previewing,
  onToggle,
  onChange,
  onMove,
  onRemove,
  onPreview,
}: StopCardProps) {
  const n = index + 1;
  const hasError = Object.values(errors).some(Boolean);
  const open = openProp || hasError;
  const detailsId = `tour-stop-details-${stop.id}`;
  const parts = chunkTalkTrack(stop.talkTrack).length;
  const factCount = stop.facts.filter((f) => f.trim()).length;
  const summary = [`${parts} ${parts === 1 ? 'part' : 'parts'}`, factCount ? `${factCount} facts` : null, stop.demo ? 'Demo' : null].filter(Boolean).join(' · ');

  const pickSkill = (chosen: string) => {
    // Re-selecting the stop's own unknown skill must not wipe it.
    if (chosen && stop.demo && chosen === stop.demo.skillId) return;
    const skill = skills.find((s) => s.id === chosen);
    onChange({
      demo: skill
        ? { skillId: skill.id, skillName: skill.name, modelVersionId: skill.linkedModelVersionId ?? null, expectSeconds: skill.timeout ?? DEFAULT_DEMO_SECONDS }
        : null,
    });
  };
  // A demo the library does not list (seeded, deleted, or a library that failed to load) keeps its own option.
  const demoOptions = [
    ...(stop.demo && !skills.some((s) => s.id === stop.demo?.skillId)
      ? [{ value: stop.demo.skillId, label: `${stop.demo.skillName || stop.demo.skillId} · not in the skill library` }]
      : []),
    ...skills.map((s) => ({ value: s.id, label: `${s.name}${s.version ? ` · ${s.version}` : ''}` })),
  ];

  return (
    <li className="flex min-w-0 items-start gap-3" data-testid="tour-stop" data-index={index}>
      <span
        className={cn(
          'relative z-10 mt-3 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums',
          hasError ? 'border-signal-stopped bg-panel text-signal-stopped' : 'border-primary/30 bg-primary/10 text-primary',
        )}
        aria-hidden="true"
      >
        {n}
      </span>
      <Panel variant="inset" padding="sm" className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <button
            type="button"
            className="flex min-w-0 flex-1 flex-col items-start rounded-control text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            aria-expanded={open}
            aria-controls={detailsId}
            aria-label={`Stop ${n} details`}
            onClick={onToggle}
          >
            <span className="flex max-w-full items-center gap-2">
              <span className="truncate text-sm font-medium text-ink-primary">{stop.headline || stop.placeId || 'Unnamed stop'}</span>
              <ChevronDown className={cn('h-4 w-4 shrink-0 text-ink-tertiary transition-transform', open && 'rotate-180')} strokeWidth={1.75} aria-hidden="true" />
            </span>
            <span className="text-xs text-ink-tertiary">{summary}</span>
          </button>
          <div className="flex shrink-0 gap-0.5">
            <Button variant="ghost" size="sm" iconOnly aria-label={`Move stop ${n} up`} data-testid="tour-stop-up" disabled={index === 0} onClick={() => onMove(-1)}>
              <ArrowUp className="h-4 w-4" strokeWidth={1.75} />
            </Button>
            <Button variant="ghost" size="sm" iconOnly aria-label={`Move stop ${n} down`} data-testid="tour-stop-down" disabled={index === count - 1} onClick={() => onMove(1)}>
              <ArrowDown className="h-4 w-4" strokeWidth={1.75} />
            </Button>
            <Button variant="ghost" size="sm" iconOnly aria-label={`Remove stop ${n}`} data-testid="tour-stop-remove" onClick={onRemove}>
              <Trash2 className="h-4 w-4" strokeWidth={1.75} />
            </Button>
          </div>
        </div>

        {/* Folded with `hidden`, never unmounted: typed values survive a fold. */}
        <div id={detailsId} className={cn('flex min-w-0 flex-col gap-4', !open && 'hidden')}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Headline" required error={errors.headline} hint={`${stop.headline.length} of ${TOUR_HEADLINE_MAX} characters`}>
              <Input aria-label={`Stop ${n} headline`} data-testid="tour-stop-headline" maxLength={TOUR_HEADLINE_MAX} value={stop.headline} onChange={(e) => onChange({ headline: e.target.value })} />
            </FormField>
            <FormField label="Place id" required error={errors.place}>
              <Input className="font-mono" aria-label={`Stop ${n} place id`} list={placesListId} value={stop.placeId} onChange={(e) => onChange({ placeId: e.target.value })} />
            </FormField>
          </div>
          <FormField label="Talk track" required error={errors.talkTrack} hint="Said verbatim, in parts of up to two sentences.">
            <Textarea
              rows={4}
              aria-label={`Stop ${n} talk track`}
              data-testid="tour-stop-talktrack"
              maxLength={TOUR_TALK_TRACK_MAX}
              value={stop.talkTrack}
              placeholder="Hier ist meine Arbeitsstation. Ich lege einen Apfel auf den Teller."
              onChange={(e) => onChange({ talkTrack: e.target.value })}
            />
          </FormField>
          <div className="-mt-2 flex min-w-0 flex-wrap items-center gap-2">
            <TalkTrackMeter talkTrack={stop.talkTrack} stopNumber={n} />
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto"
              leftIcon={<Volume2 className="h-4 w-4" strokeWidth={1.75} />}
              data-testid="tour-stop-preview"
              aria-label={`Hear stop ${n}`}
              disabled={!stop.talkTrack.trim() || previewing}
              isLoading={previewing}
              onClick={onPreview}
            >
              Hear it
            </Button>
          </div>
          <FormField label="Facts" hint="The only ground for answering a question at this stop." error={errors.facts}>
            <FactList
              label={`Stop ${n} fact`}
              facts={stop.facts}
              max={TOUR_FACTS_MAX}
              maxLength={TOUR_FACT_MAX}
              placeholder="The model was trained on 120 demonstrations recorded on this robot."
              onChange={(facts) => onChange({ facts })}
              testId="tour-stop-facts"
            />
          </FormField>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[8rem_minmax(0,1fr)] sm:items-center">
            {/* Capped at what the robot's `wait` block honours (TOUR_DWELL_MAX_S). */}
            <FormField label="Dwell" hint="Seconds">
              <Input
                type="number"
                min={0}
                max={TOUR_DWELL_MAX_S}
                aria-label={`Stop ${n} dwell seconds`}
                value={stop.dwellS}
                onChange={(e) => onChange({ dwellS: Math.max(0, Math.min(TOUR_DWELL_MAX_S, Number(e.target.value) || 0)) })}
              />
            </FormField>
            <Checkbox
              label='Ask "shall we go on?" before walking on'
              aria-label={`Stop ${n} ask to continue`}
              checked={stop.askToContinue}
              onChange={(e) => onChange({ askToContinue: e.target.checked })}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_8rem]">
            <FormField label="Demo skill" aside="Optional" error={errors.demo}>
              <Select
                aria-label={`Stop ${n} demo skill`}
                data-testid="tour-stop-demo"
                value={stop.demo?.skillId ?? ''}
                onChange={(e) => pickSkill(e.target.value)}
                options={[{ value: '', label: 'No demo' }, ...demoOptions]}
              />
            </FormField>
            <FormField label="Takes" hint="Seconds">
              <Input
                type="number"
                min={0}
                aria-label={`Stop ${n} demo seconds`}
                disabled={!stop.demo}
                value={stop.demo?.expectSeconds ?? 0}
                onChange={(e) => onChange({ demo: stop.demo ? { ...stop.demo, expectSeconds: Number(e.target.value) } : null })}
              />
            </FormField>
          </div>
        </div>
      </Panel>
    </li>
  );
});

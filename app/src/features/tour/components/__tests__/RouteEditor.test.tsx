/**
 * @file RouteEditor.test.tsx
 * @description The tour editor: the talk-track meter reports the robot's own
 *              chunking and seconds, the fact caps are enforced in the UI (not
 *              only on save), and `validateDraft` refuses the drafts the robot
 *              could not walk.
 * @feature tour
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/utils';
import { RouteEditor, draftFromRoute, draftToInput, moveStop, validateDraft } from '../RouteEditor';
import { useTourStore } from '../../store/tourStore';
import { tourApi } from '../../api/tourApi';
import { voiceApi } from '@/features/robots/api/voiceApi';
import type { TourRoute, TourStop } from '../../types/tour.types';
import { TOUR_FACTS_MAX } from '../../types/tour.types';

vi.mock('@/features/robots/api/voiceApi', () => ({
  voiceApi: { say: vi.fn() },
}));
vi.mock('../../api/tourApi', () => ({
  tourApi: {
    listPlaces: vi.fn(),
    listSkills: vi.fn(),
    createRoute: vi.fn(),
    updateRoute: vi.fn(),
  },
}));
const api = vi.mocked(tourApi);
const voice = vi.mocked(voiceApi);

const stop = (over: Partial<TourStop> = {}): TourStop => ({
  id: 'stop-a',
  placeId: 'AISLE-1',
  headline: 'Workstation',
  talkTrack: 'Hier ist meine Arbeitsstation. Ich lege einen Apfel auf den Teller.',
  facts: [],
  demo: null,
  dwellS: 12,
  askToContinue: false,
  ...over,
});

const route: TourRoute = {
  id: 'route-1',
  name: 'ZeMA visitor tour',
  robotId: 'g1',
  twinId: null,
  language: 'de',
  greetingPlaceId: 'STAGING',
  greeting: 'Hallo!',
  offer: 'Soll ich Ihnen alles zeigen?',
  farewell: 'Tschüss!',
  siteCard: [],
  stops: [stop()],
  enabled: true,
  autoGreet: true,
  createdAt: 'x',
  updatedAt: 'x',
};

beforeEach(() => {
  useTourStore.getState().reset();
  vi.clearAllMocks();
  api.listPlaces.mockResolvedValue([{ id: 'AISLE-1', name: 'Aisle 1' }]);
  api.listSkills.mockResolvedValue([{ id: 'sk-1', name: 'Apple pick and place', version: '1.0.0', timeout: 30, linkedModelVersionId: 'mv-1' }]);
  voice.say.mockResolvedValue({ accepted: true, text: '' });
});

describe('validateDraft', () => {
  it('refuses a tour the robot could not walk or could not talk through', () => {
    const empty = draftFromRoute(null);
    const problems = validateDraft(empty);
    expect(problems).toEqual(
      expect.arrayContaining([
        'Give the tour a name.',
        'Say where the robot waits for visitors and returns to.',
        'Add at least one stop.',
      ])
    );
    expect(validateDraft(draftFromRoute(route))).toEqual([]);
  });

  it('holds the caps the ROBOT enforces, even for a route loaded over them', () => {
    const over = draftFromRoute({
      ...route,
      stops: [stop({ facts: Array.from({ length: TOUR_FACTS_MAX + 1 }, (_, i) => `fact ${i}`), talkTrack: 'x'.repeat(601) })],
    });
    expect(validateDraft(over)).toEqual(
      expect.arrayContaining([`Stop 1 has more than ${TOUR_FACTS_MAX} facts.`, "Stop 1's talk track is over 600 characters."])
    );
  });

  it('moveStop reorders, and out-of-range moves are no-ops', () => {
    const list = [stop({ id: 'a' }), stop({ id: 'b' })];
    expect(moveStop(list, 0, 1).map((s) => s.id)).toEqual(['b', 'a']);
    expect(moveStop(list, 0, -1)).toBe(list);
  });

  it('draftToInput trims and drops the blank facts an operator left behind', () => {
    const draft = draftFromRoute({ ...route, name: '  ZeMA  ', siteCard: ['  a fact  ', '   '] });
    const input = draftToInput(draft);
    expect(input.name).toBe('ZeMA');
    expect(input.siteCard).toEqual(['a fact']);
  });
});

/** The editor loads its places and the skill library on mount; let both land. */
const settle = () => waitFor(() => expect(api.listSkills).toHaveBeenCalled());

describe('RouteEditor', () => {
  it('lists the robot’s places and adds stops in order; up/down/remove reorder them', async () => {
    renderWithProviders(<RouteEditor robots={[{ id: 'g1', name: 'Alpha' }]} defaultRobotId="g1" onSaved={vi.fn()} />, { withAuth: false });
    await waitFor(() => expect(api.listPlaces).toHaveBeenCalledWith('g1'));
    const pick = (await screen.findByTestId('tour-place-pick')) as HTMLSelectElement;
    await waitFor(() => expect(pick.options.length).toBeGreaterThan(2));

    fireEvent.change(pick, { target: { value: 'AISLE-1' } });
    fireEvent.click(screen.getByTestId('tour-stop-add'));
    fireEvent.change(pick, { target: { value: '__manual__' } });
    fireEvent.change(screen.getByTestId('tour-place-manual'), { target: { value: 'DOCK-1' } });
    fireEvent.click(screen.getByTestId('tour-stop-add'));

    expect(screen.getAllByTestId('tour-stop')).toHaveLength(2);
    // The picked place seeds the headline, so a stop is never nameless.
    expect(screen.getByLabelText('Stop 1 headline')).toHaveValue('Aisle 1');
    expect(screen.getByLabelText('Stop 2 place id')).toHaveValue('DOCK-1');

    fireEvent.click(screen.getByLabelText('Move stop 2 up'));
    expect(screen.getByLabelText('Stop 1 place id')).toHaveValue('DOCK-1');
    fireEvent.click(screen.getByLabelText('Remove stop 1'));
    expect(screen.getAllByTestId('tour-stop')).toHaveLength(1);
    expect(screen.getByLabelText('Stop 1 place id')).toHaveValue('AISLE-1');
  });

  it('attaches a demo from the skill library and seeds its length from the skill', async () => {
    renderWithProviders(<RouteEditor route={route} robots={[{ id: 'g1', name: 'Alpha' }]} onSaved={vi.fn()} />, { withAuth: false });
    await settle();
    fireEvent.change(screen.getByLabelText('Stop 1 demo skill'), { target: { value: 'sk-1' } });
    // 30 s is the skill's own timeout — the duration estimate starts honest.
    expect(screen.getByLabelText('Stop 1 demo seconds')).toHaveValue(30);
  });

  it('the talk-track meter reports the robot’s own parts and seconds', async () => {
    renderWithProviders(<RouteEditor route={route} robots={[{ id: 'g1', name: 'Alpha' }]} onSaved={vi.fn()} />, { withAuth: false });
    await settle();
    const meter = screen.getByTestId('tour-talktrack-meter');
    // Two sentences → one ≤2-sentence part; 67 chars at 14 chars/s → 4.8 s.
    expect(within(meter).getByTestId('tour-talktrack-chars')).toHaveTextContent('67/600 chars');
    expect(within(meter).getByTestId('tour-talktrack-seconds')).toHaveTextContent('≈ 4.8 s in 1 part');
    expect(screen.queryByTestId('tour-talktrack-truncated')).toBeNull();
  });

  it('says when the per-stop speech cap will cut the track short', async () => {
    const long = Array.from({ length: 17 }, (_, i) => `Dies ist Satz ${String(i + 1).padStart(2, '0')} an dieser Station.`).join(' ');
    renderWithProviders(<RouteEditor route={{ ...route, stops: [stop({ talkTrack: long })] }} robots={[]} onSaved={vi.fn()} />, { withAuth: false });
    await settle();
    // Silently dropping the tail of an authored paragraph is the kind of
    // surprise that only shows up in front of a visitor.
    expect(screen.getByTestId('tour-talktrack-truncated')).toHaveTextContent('the rest is not said');
  });

  it('stops adding facts at the cap instead of truncating them later', async () => {
    renderWithProviders(
      <RouteEditor route={{ ...route, stops: [stop({ facts: Array.from({ length: TOUR_FACTS_MAX }, (_, i) => `fact ${i}`) })] }} robots={[]} onSaved={vi.fn()} />,
      { withAuth: false }
    );
    await settle();
    const facts = screen.getByTestId('tour-stop-facts');
    expect(within(facts).getAllByTestId('tour-stop-facts-input')).toHaveLength(TOUR_FACTS_MAX);
    expect(within(facts).getByTestId('tour-stop-facts-add')).toBeDisabled();
    // Each field is capped at 200 characters at the input, not after the fact.
    expect(within(facts).getAllByTestId('tour-stop-facts-input')[0]).toHaveAttribute('maxlength', '200');
  });

  it('blocks Save while the draft is incomplete and lists why', async () => {
    renderWithProviders(<RouteEditor robots={[]} onSaved={vi.fn()} />, { withAuth: false });
    await settle();
    expect(screen.getByTestId('tour-route-save')).toBeDisabled();
    expect(screen.getByTestId('tour-editor-problems')).toHaveTextContent('Add at least one stop.');
  });

  it('"Hear it" speaks what the visitor would hear — the kept chunks, not the raw field', async () => {
    const long = Array.from({ length: 17 }, (_, i) => `Dies ist Satz ${String(i + 1).padStart(2, '0')} an dieser Station.`).join(' ');
    renderWithProviders(<RouteEditor route={{ ...route, stops: [stop({ talkTrack: long })] }} robots={[{ id: 'g1', name: 'Alpha' }]} onSaved={vi.fn()} />, {
      withAuth: false,
    });
    await settle();
    fireEvent.click(screen.getByTestId('tour-stop-preview'));
    await waitFor(() => expect(voice.say).toHaveBeenCalled());
    const [robotId, spoken, language] = voice.say.mock.calls[0]!;
    expect(robotId).toBe('g1');
    expect(language).toBe('de');
    // The tail past the 40 s cap is not said on the tour, so it is not said here.
    expect(spoken).toContain('Satz 14');
    expect(spoken).not.toContain('Satz 15');
    expect(await screen.findByTestId('tour-preview-note')).toHaveTextContent(/Sent to the robot/);
  });

  it('says when the voice service could not play the preview', async () => {
    voice.say.mockRejectedValue(new Error('voice service unreachable'));
    renderWithProviders(<RouteEditor route={route} robots={[{ id: 'g1', name: 'Alpha' }]} onSaved={vi.fn()} />, { withAuth: false });
    await settle();
    fireEvent.click(screen.getByTestId('tour-stop-preview'));
    // Silence is indistinguishable from a broken speaker; the author is told.
    expect(await screen.findByTestId('tour-preview-note')).toHaveTextContent('voice service unreachable');
  });

  it('warns that an armed auto-greet on a disabled tour never speaks', async () => {
    renderWithProviders(<RouteEditor route={route} robots={[]} onSaved={vi.fn()} />, { withAuth: false });
    await settle();
    expect(screen.queryByTestId('tour-autogreet-inert')).toBeNull();
    fireEvent.click(screen.getByTestId('tour-route-enabled'));
    expect(screen.getByTestId('tour-autogreet-inert')).toHaveTextContent('will not offer it to anyone');
  });
});

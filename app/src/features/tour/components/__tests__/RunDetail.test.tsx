/**
 * @file RunDetail.test.tsx
 * @description RunDetail renders one visit: the stop timeline with what was
 *              said and what a demo actually did, the Q&A transcript badged per
 *              turn, the declined questions collected as "Facts to add", and a
 *              swept transcript that says so instead of showing an empty list.
 * @feature tour
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/utils';
import { RunDetail } from '../RunDetail';
import { useTourStore } from '../../store/tourStore';
import { tourApi } from '../../api/tourApi';
import type { TourRoute, TourRun } from '../../types/tour.types';

vi.mock('../../api/tourApi', () => ({
  tourApi: {
    getRun: vi.fn(),
    getRoute: vi.fn(),
  },
}));
const api = vi.mocked(tourApi);

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
  stops: [],
  enabled: true,
  autoGreet: true,
  createdAt: 'x',
  updatedAt: 'x',
};

const run: TourRun = {
  runId: 'run-1',
  routeId: 'route-1',
  routeName: 'ZeMA visitor tour',
  robotId: 'g1',
  origin: 'visitor',
  status: 'done',
  startedAt: '2026-08-17T13:00:00.000Z',
  finishedAt: '2026-08-17T13:08:00.000Z',
  legs: [
    { index: 0, stopId: 'stop-a', placeId: 'STAGING', name: 'Reception', status: 'done', spoken: { said: 2, of: 2 } },
    {
      index: 1,
      stopId: 'stop-b',
      placeId: 'AISLE-1',
      name: 'Workstation',
      status: 'done',
      spoken: { said: 1, of: 3 },
      demo: { mode: 'narrate', status: 'narrated', skillId: 'sk-1', skillName: 'Apple pick and place', model: 'pi0-apple-v3' },
      message: 'described the skill; the last real run took 24 s',
    },
  ],
  turns: [
    {
      at: '2026-08-17T13:03:00.000Z',
      stopId: 'stop-b',
      question: 'Welches Modell steuert die Hand?',
      answer: 'Ein VLA-Modell, das wir selbst trainiert haben.',
      answered: 'grounded',
      language: 'de',
    },
    {
      at: '2026-08-17T13:04:00.000Z',
      stopId: 'stop-b',
      question: 'Wie viel hat der Roboter gekostet?',
      answer: 'Das weiß ich nicht — ich gebe die Frage weiter.',
      answered: 'declined',
      language: 'de',
    },
  ],
  language: 'de',
  disclosureSpoken: true,
};

beforeEach(() => {
  useTourStore.getState().reset();
  vi.clearAllMocks();
  api.getRun.mockResolvedValue(run);
  api.getRoute.mockResolvedValue(route);
});

describe('RunDetail', () => {
  it('renders the header, the stops and the transcript from the server', async () => {
    renderWithProviders(<RunDetail runId="run-1" robotNames={{ g1: 'Alpha' }} />, { withAuth: false });
    const detail = await screen.findByTestId('tour-run-detail');
    expect(detail).toHaveTextContent('ZeMA visitor tour');
    expect(detail).toHaveTextContent('Visitor accepted the offer');
    expect(detail).toHaveTextContent('Alpha');

    const legs = screen.getAllByTestId('tour-leg');
    expect(legs).toHaveLength(2);
    expect(legs[0]).toHaveTextContent('Reception');
    // A stop cut short has to be visible, not inferred from a status pill.
    expect(legs[1]).toHaveTextContent('said 1 of 3');

    const turns = screen.getAllByTestId('tour-turn');
    expect(turns).toHaveLength(2);
    expect(turns[0]).toHaveTextContent('Welches Modell steuert die Hand?');
    expect(within(turns[0]).getByTestId('tour-turn-answer')).toHaveTextContent('Grounded');
    expect(within(turns[1]).getByTestId('tour-turn-answer')).toHaveTextContent('Declined');
  });

  it('a narrated demo says it was described, never that the robot grasped anything', async () => {
    renderWithProviders(<RunDetail runId="run-1" />, { withAuth: false });
    const demo = await screen.findByTestId('tour-leg-demo');
    expect(within(demo).getByTestId('tour-demo-mode')).toHaveTextContent('Described only');
    expect(demo).toHaveTextContent('Apple pick and place');
    expect(demo).toHaveTextContent('narrated');
    expect(demo).not.toHaveTextContent(/Ran the skill/);
  });

  it('declined questions surface as "Facts to add"', async () => {
    renderWithProviders(<RunDetail runId="run-1" />, { withAuth: false });
    const panel = await screen.findByTestId('tour-facts-to-add');
    expect(panel).toHaveTextContent('Facts to add');
    expect(panel).toHaveTextContent('Wie viel hat der Roboter gekostet?');
    // Only the declined one — a grounded answer is not work to do.
    expect(panel).not.toHaveTextContent('Welches Modell steuert die Hand?');
    expect(within(panel).getByRole('link')).toHaveAttribute('href', '/tour/routes/route-1');
  });

  it('records that the AI disclosure was spoken (EU AI Act Art. 50)', async () => {
    renderWithProviders(<RunDetail runId="run-1" />, { withAuth: false });
    expect(await screen.findByTestId('tour-disclosure')).toHaveTextContent('AI disclosure spoken');
  });

  it('says so when the disclosure was NOT recorded as spoken', async () => {
    // A greeting that never reached the speaker disclosed nothing; printing the
    // reassuring sentence anyway would make the compliance record a fiction.
    api.getRun.mockResolvedValue({ ...run, runId: 'run-2', disclosureSpoken: false });
    renderWithProviders(<RunDetail runId="run-2" />, { withAuth: false });
    expect(await screen.findByTestId('tour-disclosure')).toHaveTextContent('NOT recorded as spoken');
  });

  it('a swept transcript says so — never an empty list pretending nothing was asked', async () => {
    // The robot clears a run's turns past the retention window and keeps the
    // run. "No questions were asked" would be a claim this record cannot make.
    api.getRun.mockResolvedValue({ ...run, runId: 'run-old', startedAt: '2026-01-05T13:00:00.000Z', finishedAt: '2026-01-05T13:08:00.000Z', turns: [] });
    renderWithProviders(<RunDetail runId="run-old" />, { withAuth: false });
    const swept = await screen.findByTestId('tour-transcript-swept');
    expect(swept).toHaveTextContent('passed its retention window');
    expect(screen.queryByTestId('tour-transcript-empty')).toBeNull();
    expect(screen.queryByTestId('tour-facts-to-add')).toBeNull();
  });

  it('a recent visit with no questions says nobody asked', async () => {
    api.getRun.mockResolvedValue({ ...run, runId: 'run-quiet', startedAt: new Date().toISOString(), turns: [] });
    renderWithProviders(<RunDetail runId="run-quiet" />, { withAuth: false });
    expect(await screen.findByTestId('tour-transcript-empty')).toHaveTextContent('No questions were asked');
  });

  it('a declined offer shows its reason and walks nowhere', async () => {
    api.getRun.mockResolvedValue({
      ...run,
      runId: 'run-no',
      status: 'declined',
      reason: 'the visitor said no thank you',
      legs: [],
      turns: [],
    });
    renderWithProviders(<RunDetail runId="run-no" />, { withAuth: false });
    expect(await screen.findByTestId('tour-run-reason')).toHaveTextContent('the visitor said no thank you');
    expect(screen.queryAllByTestId('tour-leg')).toHaveLength(0);
  });
});

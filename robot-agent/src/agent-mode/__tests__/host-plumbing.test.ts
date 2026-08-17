/**
 * @file host-plumbing.test.ts
 * @description The controller's side of TASK-213: a person who appears is
 *              greeted with the site's welcome, the AI disclosure and the offer
 *              (never through the planner); "ja" starts the tour and "nein"
 *              declines it, both without a model call; a question during a tour
 *              is answered from the authored facts and an uncovered one is
 *              declined rather than invented; a stop word still outranks the
 *              whole conversation; and a tour an operator started refuses fail-
 *              closed with a skipped run the server can see.
 * @feature agentmode
 * @status test
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AgentModeController } from '../agent-mode-controller.js';
import { ControlOwnerLock } from '../control-owner.js';
import { TourRouteSource } from '../host.js';
import { RangeSensor } from '../range.js';
import { SceneMemoryStore } from '../scene-memory.js';
import { Workspace } from '../workspace.js';
import type { GenerateFn } from '../llm.js';
import type { Planner, PlannedBlock } from '../planner.js';
import type { Place } from '../place-resolver.js';
import type { ServerMirror } from '../server-mirror.js';
import type { VisionClient, VisionObservation } from '../vision.js';
import type { RobotStateManager } from '../../robot/state.js';
import type { AgentModeEvent, TourRoute } from '../types.js';

const VIEW: VisionObservation = {
  currentView: 'a person in a warehouse aisle',
  entities: [{ label: 'person', bearingDeg: 0, distanceEstM: 2.5, confidence: 0.9 }],
  personVisible: true,
  raw: '{}',
  degraded: false,
};

function place(id: string, name: string, half: number): Place {
  return {
    id,
    name,
    placeType: 'cell',
    floor: 0,
    polygon: [[-half, -half], [half, -half], [half, half], [-half, half]],
    source: 'surveyed',
    keepout: false,
    landmarks: [],
  };
}
const PLACES = [place('STAGING', 'Staging', 1.5), place('AISLE-1', 'Aisle 1', 1.5)];

const ROUTE: TourRoute = {
  id: 'zema-visit',
  name: 'ZeMA visitor tour',
  robotId: 'robot-1',
  twinId: null,
  language: 'de',
  greetingPlaceId: 'STAGING',
  greeting: 'Herzlich willkommen am ZeMA!',
  offer: 'Soll ich Ihnen alles zeigen?',
  farewell: 'Danke für Ihren Besuch!',
  siteCard: ['Das ZeMA ist ein Forschungsinstitut.'],
  stops: [
    {
      id: 'stop-1',
      placeId: 'AISLE-1',
      headline: 'Meine Arbeitsstation',
      talkTrack: 'Hier ist meine Arbeitsstation.',
      facts: ['Das Modell ist ein VLA-Modell, das wir selbst trainiert haben.'],
      demo: null,
      dwellS: 1,
      askToContinue: false,
    },
  ],
  enabled: true,
  autoGreet: true,
  createdAt: '2026-08-17T00:00:00.000Z',
  updatedAt: '2026-08-17T00:00:00.000Z',
};

interface RigOpts {
  hostEnabled?: boolean;
  routeId?: string;
  route?: TourRoute;
  battery?: number;
  generate?: GenerateFn;
  plannerBlocks?: PlannedBlock[];
}

function rig(opts: RigOpts = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'neodem-host-ctl-'));
  const ws = new Workspace({ root, robotId: 'robot-1' });
  ws.ensure();
  const events: AgentModeEvent[] = [];
  const said: string[] = [];
  const planned: string[] = [];
  const scene = new SceneMemoryStore('robot-1');
  const route = opts.route ?? ROUTE;
  const controller = new AgentModeController({
    robotId: 'robot-1',
    enabled: true,
    lock: new ControlOwnerLock(),
    scene,
    mapKeeper: null,
    peerTracker: null,
    memory: ws,
    journal: null,
    identity: null,
    navPlanner: 'grid',
    hostEnabled: opts.hostEnabled ?? true,
    tourRouteId: opts.routeId ?? ROUTE.id,
    idleWatchIntervalMs: 1,
    patrolEnabled: false,
    tourRoutes: new TourRouteSource({
      serverUrl: 'http://127.0.0.1:9',
      cachePath: path.join(root, 'tour-routes.json'),
      fetchImpl: (async (url: string) =>
        String(url).includes(route.id)
          ? new Response(JSON.stringify(route), { status: 200 })
          : new Response('no', { status: 404 })) as unknown as typeof fetch,
    }),
    getPose: () => ({ x: 0, y: 0, yawDeg: 0, source: 'sim', atMs: 1e12 }),
    planner: {
      plan: async (input: { command: string }) => {
        planned.push(input.command);
        return { blocks: opts.plannerBlocks ?? [{ kind: 'wave' as const, params: {} }], fallback: false, attempts: 1 };
      },
    } as unknown as Planner,
    mirror: { emit: () => {}, push: async () => {}, logBlock: async () => {}, uploadPatrolPhoto: () => {} } as unknown as ServerMirror,
    vision: { observe: async () => VIEW } as unknown as VisionClient,
    range: new RangeSensor({ enabled: false }),
    loco: {
      move: async () => ({ ok: true }),
      action: async () => ({ ok: true }),
      fsm: async () => ({ ok: true }),
      standHeight: async () => ({ ok: true }),
      odometry: async () => null,
    },
    say: async (text: string) => {
      said.push(text);
      return true;
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 1))),
    ...(opts.generate ? { generate: opts.generate } : {}),
  });
  controller.subscribe((e) => events.push(e));
  controller.attach({
    isEStopTriggered: () => false,
    isTeleopActive: () => false,
    isVLAActive: () => false,
    getState: () => ({ batteryLevel: opts.battery ?? 90 }),
    getPlaceBelief: () => ({
      place: { id: 'STAGING', name: 'Staging', placeType: 'cell', confidence: 'confirmed', source: 'surveyed' },
      poseM: { x: 0, y: 0 },
      poseSource: 'odometry',
      driftSinceAnchorM: 0,
      ageMs: 500,
      insideKeepout: false,
    }),
    getPlaces: () => PLACES,
    getPlaceFrameRegistration: () => ({ registered: true, how: 'identity' }),
    triggerEmergencyStop: () => {},
    resetEmergencyStop: () => true,
  } as unknown as RobotStateManager);
  return { controller, events, said, planned, root, ws };
}

/** A model that answers the grounded-answerer prompt with fixed JSON. */
function answerer(payload: { answer: string; source: string }): GenerateFn {
  return async () => ({ text: JSON.stringify(payload), output: null });
}

const rigs: Array<ReturnType<typeof rig>> = [];
afterEach(() => {
  for (const r of rigs.splice(0)) {
    r.controller.dispose();
    fs.rmSync(r.root, { recursive: true, force: true });
  }
});

/**
 * Run the idle watcher until the greeting has been said and the plan is over.
 * The watcher is the production trigger — a test that called the greeter
 * directly would not prove the person-appeared edge reaches it.
 */
async function greetOnce(controller: AgentModeController): Promise<void> {
  controller.startIdleWatcher();
  for (let i = 0; i < 200; i++) {
    await new Promise((r) => setTimeout(r, 5));
    if (controller.tourStatus().pending || controller.getState().plan) break;
  }
  await settle(controller);
  controller.stopIdleWatcher();
  // The offer is armed after the greeting plan has finished.
  for (let i = 0; i < 100 && !controller.tourStatus().pending; i++) {
    await new Promise((r) => setTimeout(r, 5));
  }
}

async function settle(controller: AgentModeController): Promise<void> {
  // The greeting runs as a proactive plan; give the event loop the turns it
  // needs rather than guessing at a timeout.
  for (let i = 0; i < 50; i++) {
    if (!controller.isRunning()) break;
    await new Promise((r) => setTimeout(r, 5));
  }
  await new Promise((r) => setTimeout(r, 5));
}

describe('host plumbing — greeting a visitor', () => {
  it('greets with the route greeting, the AI disclosure and the offer, and never asks the planner', async () => {
    const h = rig({ routeId: ROUTE.id });
    rigs.push(h);
    await greetOnce(h.controller);

    const greeting = h.said.find((s) => s.includes('Herzlich willkommen'));
    expect(greeting).toBeDefined();
    expect(greeting).toContain('künstlicher Intelligenz');
    expect(greeting).toContain('Soll ich Ihnen alles zeigen?');
    // Not one model call was made to produce it.
    expect(h.planned).toEqual([]);
    expect(h.controller.tourStatus().pending).toMatchObject({ kind: 'offer' });
  });

  it('"ja" starts the tour and "nein" declines it, with no planner in either path', async () => {
    const yes = rig();
    rigs.push(yes);
    await greetOnce(yes.controller);
    const started = await yes.controller.submitCommand({ text: 'Ja, gerne!', spoken: true, language: 'de' });
    expect(started.accepted).toBe(true);
    expect(yes.controller.tourStatus().run?.status).toBe('running');
    yes.controller.abortTour('test');
    await settle(yes.controller);

    const no = rig();
    rigs.push(no);
    await greetOnce(no.controller);
    const declined = await no.controller.submitCommand({ text: 'Nein danke', spoken: true, language: 'de' });
    expect(declined).toMatchObject({ accepted: true, outcome: 'answered' });
    expect(no.controller.tourStatus().run).toBeNull();
    const finished = no.events.filter((e) => e.type === 'agent:tour:finished');
    expect(finished.at(-1)!.tour).toMatchObject({ status: 'declined', disclosureSpoken: true });
    expect(no.planned).toEqual([]);
  });

  it('answers a German offer in German even when the caller names no language', async () => {
    // The visitor's "ja" arrives from a microphone, not from a UI that knows
    // which language the site greets in. The route does, and the acceptance
    // must follow it — this used to come out as "Wonderful — follow me,
    // please." in the middle of a German tour, because the run whose language
    // would have been read does not exist yet at that moment.
    const h = rig();
    rigs.push(h);
    await greetOnce(h.controller);
    await h.controller.submitCommand({ text: 'Ja, gerne!', spoken: true });
    expect(h.said).toContain('Wunderbar — folgen Sie mir bitte.');
    expect(h.said.some((line) => line.includes('follow me, please'))).toBe(false);
    h.controller.abortTour('test');
    await settle(h.controller);
  });

  it('a stop word still outranks the conversation', async () => {
    const h = rig();
    rigs.push(h);
    await greetOnce(h.controller);
    const res = await h.controller.submitCommand({ text: 'stopp', spoken: true, language: 'de' });
    expect(res.outcome).toBe('estop');
    expect(h.controller.tourStatus().run).toBeNull();
  });
});

describe('host plumbing — answering a visitor', () => {
  it('answers from the authored facts and records the turn as grounded', async () => {
    const h = rig({ generate: answerer({ answer: 'Wir haben das Modell selbst trainiert.', source: 'facts' }) });
    rigs.push(h);
    const started = await h.controller.startTour({ routeId: ROUTE.id, origin: 'operator', route: ROUTE });
    expect(started.accepted).toBe(true);

    const asked = await h.controller.submitCommand({
      text: 'Was für ein Modell steuert dich denn?',
      spoken: true,
      language: 'de',
    });
    expect(asked).toMatchObject({ accepted: true, outcome: 'answered' });
    await settle(h.controller);

    const finished = h.events.filter((e) => e.type === 'agent:tour:finished').at(-1);
    expect(finished!.tour!.turns).toHaveLength(1);
    expect(finished!.tour!.turns[0]).toMatchObject({ answered: 'grounded', language: 'de' });
    expect(h.said).toContain('Wir haben das Modell selbst trainiert.');
  });

  it('declines a question the facts do not cover instead of inventing an answer', async () => {
    const h = rig({ generate: answerer({ answer: 'Das weiß ich leider nicht.', source: 'unknown' }) });
    rigs.push(h);
    await h.controller.startTour({ routeId: ROUTE.id, origin: 'operator', route: ROUTE });
    await h.controller.submitCommand({ text: 'Wie viel hat der Roboter gekostet?', spoken: true, language: 'de' });
    await settle(h.controller);

    const finished = h.events.filter((e) => e.type === 'agent:tour:finished').at(-1);
    expect(finished!.tour!.turns[0]).toMatchObject({ answered: 'declined' });
  });

  it('an answer whose source the model did not name is NOT spoken to the visitor', async () => {
    // A local model that answers `{"answer":"…90.000 Euro…","source":"knowledge"}`
    // — or merely capitalises "Facts" — has named no ground. Filing it as
    // `declined` while still reading it aloud would record the honest outcome
    // and perform the dishonest one.
    const h = rig({ generate: answerer({ answer: 'Der Roboter hat 90.000 Euro gekostet.', source: 'knowledge' }) });
    rigs.push(h);
    await h.controller.startTour({ routeId: ROUTE.id, origin: 'operator', route: ROUTE });
    await h.controller.submitCommand({ text: 'Was hat der Roboter gekostet?', spoken: true, language: 'de' });
    await settle(h.controller);

    const finished = h.events.filter((e) => e.type === 'agent:tour:finished').at(-1);
    expect(finished!.tour!.turns[0]!.answered).toBe('declined');
    expect(h.said.join(' ')).not.toContain('90.000');
    expect(h.said.join(' ')).toContain('weiß ich nicht');
  });

  it('"from the facts" is not believed when there were no facts', async () => {
    const factless: TourRoute = {
      ...ROUTE,
      siteCard: [],
      stops: [{ ...ROUTE.stops[0]!, facts: [] }],
    };
    const h = rig({
      route: factless,
      generate: answerer({ answer: 'Das ZeMA wurde 2009 gegründet.', source: 'facts' }),
    });
    rigs.push(h);
    await h.controller.startTour({ routeId: factless.id, origin: 'operator', route: factless });
    await h.controller.submitCommand({ text: 'Seit wann gibt es das ZeMA?', spoken: true, language: 'de' });
    await settle(h.controller);

    const finished = h.events.filter((e) => e.type === 'agent:tour:finished').at(-1);
    // `grounded` is defined as "from the authored facts"; with none authored it
    // is not a possible answer, whatever the model says about itself.
    expect(finished!.tour!.turns[0]!.answered).toBe('declined');
    expect(h.said.join(' ')).not.toContain('2009');
  });

  it('a typed "ja" in the operator console does not answer the visitor\'s offer', async () => {
    const h = rig();
    rigs.push(h);
    await greetOnce(h.controller);
    expect(h.controller.tourStatus().pending).toMatchObject({ kind: 'offer' });

    // Typed, not spoken: whoever has the UI open is not the person standing in
    // front of the robot, and must not accept a tour on their behalf.
    await h.controller.submitCommand({ text: 'ja' });
    expect(h.controller.tourStatus().run).toBeNull();
    // The offer is still open for the visitor to answer.
    expect(h.controller.tourStatus().pending).toMatchObject({ kind: 'offer' });
  });

  it('a stray "ja" during a tour is acknowledged, not answered as a question', async () => {
    const generate = vi.fn(async () => ({ text: '{"answer":"Ich sage ja.","source":"facts"}', output: null }));
    const h = rig({ generate });
    rigs.push(h);
    await h.controller.startTour({ routeId: ROUTE.id, origin: 'operator', route: ROUTE });

    const res = await h.controller.submitCommand({ text: 'ja', spoken: true, language: 'de' });
    expect(res).toMatchObject({ accepted: true, outcome: 'answered' });
    await settle(h.controller);

    // Nothing was asked, so nothing was answered and nothing was filed.
    expect(generate).not.toHaveBeenCalled();
    const finished = h.events.filter((e) => e.type === 'agent:tour:finished').at(-1);
    expect(finished!.tour!.turns).toEqual([]);
  });

  it('a model that answers with prose instead of JSON is treated as no answer at all', async () => {
    const h = rig({
      generate: async () => ({ text: 'Der Roboter hat 92.000 Euro gekostet.', output: null }),
    });
    rigs.push(h);
    await h.controller.startTour({ routeId: ROUTE.id, origin: 'operator', route: ROUTE });
    await h.controller.submitCommand({ text: 'Was hat er gekostet?', spoken: true, language: 'de' });
    await settle(h.controller);

    const finished = h.events.filter((e) => e.type === 'agent:tour:finished').at(-1);
    expect(finished!.tour!.turns[0]!.answered).toBe('declined');
    // The invented price never reached the speaker.
    expect(h.said.join(' ')).not.toContain('92.000');
  });
});

describe('host plumbing — startTour', () => {
  it('refuses when host mode is disabled, and records a skipped run for the server', async () => {
    const h = rig({ hostEnabled: false });
    rigs.push(h);
    const res = await h.controller.startTour({ routeId: ROUTE.id, origin: 'operator', route: ROUTE });
    expect(res).toMatchObject({ accepted: false, reason: 'disabled' });
    const finished = h.events.filter((e) => e.type === 'agent:tour:finished');
    expect(finished).toHaveLength(1);
    expect(finished[0]!.tour).toMatchObject({ status: 'skipped', routeId: ROUTE.id });
    expect(finished[0]!.tour!.reason).toMatch(/^disabled:/);
  });

  it('an operator-started tour has not disclosed anything to anybody', async () => {
    const h = rig();
    rigs.push(h);
    await h.controller.startTour({ routeId: ROUTE.id, origin: 'operator', route: ROUTE });
    expect(h.controller.tourStatus().run).toMatchObject({ origin: 'operator', disclosureSpoken: false });
    h.controller.abortTour('test');
    await settle(h.controller);
  });

  it('an unknown route id is refused, not crashed on', async () => {
    const h = rig();
    rigs.push(h);
    const res = await h.controller.startTour({ routeId: 'does-not-exist', origin: 'operator' });
    expect(res).toMatchObject({ accepted: false, reason: 'route_unknown' });
  });
});

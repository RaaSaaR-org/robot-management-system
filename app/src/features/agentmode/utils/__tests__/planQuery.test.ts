/**
 * @file planQuery.test.ts
 * @description Tests for the pure plan queries — in particular reading a
 *              running host-mode tour out of the plan (TASK-213).
 * @feature agentmode
 */

import { describe, it, expect } from 'vitest';
import { tourContextOfPlan } from '../planQuery';
import type { AgentBlock, AgentPlan, AgentPlanStatus } from '../../types/agentmode.types';

let seq = 0;
const block = (
  kind: AgentBlock['kind'],
  params: Record<string, unknown> = {},
  status: AgentBlock['status'] = 'done'
): AgentBlock => ({ id: `b${++seq}`, kind, params, status });

const plan = (blocks: AgentBlock[], status: AgentPlanStatus = 'running'): AgentPlan => ({
  id: 'plan-1',
  robotId: 'g1',
  command: 'Tour',
  blocks,
  cursor: blocks.findIndex((b) => b.status === 'running'),
  status,
  createdAt: '2026-08-25T10:00:00.000Z',
  updatedAt: '2026-08-25T10:00:00.000Z',
});

/** The blocks `buildTourBlocks` produces, in order, for a two-stop route. */
const tourBlock = block('tour', { routeId: 'zema-visit', routeName: 'ZeMA visitor tour', stops: 2 }, 'running');
const stopOne = { stopId: 'stop-a', stopIndex: 1, stopName: 'Reception' };
const stopTwo = { stopId: 'stop-b', stopIndex: 2, stopName: 'Workstation' };

describe('tourContextOfPlan', () => {
  it('has no opinion about a plan that is not a tour', () => {
    expect(tourContextOfPlan(null)).toBeNull();
    expect(tourContextOfPlan(plan([block('walk', { distanceM: 1 }, 'running')]))).toBeNull();
  });

  it('names the route and the stop the robot is standing at', () => {
    const context = tourContextOfPlan(
      plan([
        tourBlock,
        block('goto', { place: 'STAGING', ...stopOne }),
        block('present', { ...stopOne, text: 'Willkommen.', chunk: 1, of: 1 }, 'running'),
      ])
    );

    expect(context).toEqual({ routeName: 'ZeMA visitor tour', stops: 2, stop: { index: 1, name: 'Reception' } });
  });

  it('keeps naming the stop while the navigator runs blocks that carry none', () => {
    // A `goto` stays `running` while the look/turn/walk blocks it generates
    // execute inside it, and those carry no stop. Reading only the block in
    // flight would blink the headline away and back several times per leg.
    const context = tourContextOfPlan(
      plan([
        tourBlock,
        block('goto', { place: 'AISLE-1', ...stopTwo }, 'running'),
        block('look', {}),
        block('turn', { angleDeg: 12 }, 'running'),
      ])
    );

    expect(context?.stop).toEqual({ index: 2, name: 'Workstation' });
  });

  it('says nothing about a stop before the first one is reached', () => {
    const context = tourContextOfPlan(
      plan([tourBlock, block('speak', { text: 'Sie sprechen mit einer KI.', disclosure: true }, 'running')])
    );

    expect(context?.stop).toBeNull();
    expect(context?.routeName).toBe('ZeMA visitor tour');
  });

  it('drops the stop once the robot walks back to the greeting place', () => {
    // The walk home is the one `goto` with no stop on it — and the moment the
    // rail must stop claiming the robot is standing at the last station.
    const context = tourContextOfPlan(
      plan([
        tourBlock,
        block('goto', { place: 'AISLE-1', ...stopTwo }),
        block('present', { ...stopTwo, text: 'Hier arbeite ich.' }),
        block('goto', { place: 'STAGING' }, 'running'),
      ])
    );

    expect(context?.stop).toBeNull();
  });

  it('ignores stops the plan has not started yet', () => {
    const context = tourContextOfPlan(
      plan([
        tourBlock,
        block('goto', { place: 'STAGING', ...stopOne }, 'running'),
        block('goto', { place: 'AISLE-1', ...stopTwo }, 'pending'),
      ])
    );

    expect(context?.stop).toEqual({ index: 1, name: 'Reception' });
  });

  it('degrades to the headline when an older agent sent no stop number', () => {
    const context = tourContextOfPlan(
      plan([tourBlock, block('present', { stopId: 'stop-a', stopName: 'Reception' }, 'running')])
    );

    expect(context?.stop).toEqual({ index: null, name: 'Reception' });
  });

  it('says nothing at all once the plan has ended', () => {
    // A finished plan is history: it cannot say where the robot is standing now.
    for (const status of ['done', 'failed', 'aborted'] as const) {
      expect(
        tourContextOfPlan(plan([tourBlock, block('present', { ...stopOne, text: 'x' })], status))
      ).toBeNull();
    }
  });

  it('falls back to the route id when the runner sent no name', () => {
    const context = tourContextOfPlan(
      plan([block('tour', { routeId: 'zema-visit', stops: 2 }, 'running')])
    );

    expect(context).toEqual({ routeName: 'zema-visit', stops: 2, stop: null });
  });
});

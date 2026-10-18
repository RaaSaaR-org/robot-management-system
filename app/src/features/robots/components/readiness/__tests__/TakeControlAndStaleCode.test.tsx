/**
 * @file TakeControlAndStaleCode.test.tsx
 * @description TASK-419 in the readiness panel: a blocked arm switch or Limp
 *              first offers "Take control" when the page can take it (D3),
 *              chained into the arm-control confirmation; a foreign process
 *              shows its start time and working directory; a process that runs
 *              older code says so, offers the stop command and never Adopt; and
 *              `agent_outdated` highlights the row of the stale process.
 * @feature robots
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/mocks/server';
import { readinessFor } from '@/mocks/readinessDemoHandlers';
import { useReadinessStore } from '../../../store/readinessStore';
import { RobotReadinessPanel, type ReadinessLease } from '../RobotReadinessPanel';
import { ReadinessRow, shortCwd, stopCommand } from '../ReadinessRow';
import { readinessRows, reasonRow, shortDateTime } from '../readinessRows';
import type { BringupStep, RobotReadiness } from '../../../api/readinessApi';

const ROBOT = 'r1';
const GRANT = { leaseId: 'lease-secret', generation: 7 };
const BOUND: ReadinessLease = { enabled: true, state: 'bound', grant: () => GRANT };

function serve(snapshot: RobotReadiness) {
  server.use(http.get(`/api/robots/${ROBOT}/readiness`, () => HttpResponse.json(snapshot)));
}

beforeEach(() => {
  useReadinessStore.getState().reset();
});

const STALE = { startedAt: '2026-10-17T15:21:00.000Z', codeAt: '2026-10-18T09:00:00.000Z' };

/** The foreign-bridge fixture with an agent foreign as well, optionally stale. */
function foreignAgent(stale: boolean): RobotReadiness {
  const base = readinessFor(ROBOT, 'bringup_foreign:bridge');
  const agent: BringupStep = {
    id: 'agent',
    state: 'foreign',
    owned: false,
    pid: 5150,
    startedAt: null,
    detail: 'pid 5150 holds :41299',
    checks: {},
    code: stale ? 'stale_code' : 'foreign_process',
    foreign: {
      pid: 5150,
      cmdline: ['node', '--import', 'tsx', 'src/index.ts'],
      since: STALE.startedAt,
      port: 41299,
      cwd: '/home/op/develop/old-tree/robot-agent',
      robotId: 'sim-g1-edu-dev',
      staleCode: stale ? STALE : null,
    },
    actions: stale ? ['leave'] : ['adopt', 'leave'],
  };
  return {
    ...base,
    bringup: { ...base.bringup!, steps: base.bringup!.steps.map((s) => (s.id === 'agent' ? agent : s.id === 'bridge' ? { ...s, state: 'idle', foreign: null, actions: [] } : s)) },
    agent: { reachable: true, error: 'HTTP 404 (no readiness route)', readiness: null, outdated: true },
    reason: stale
      ? { code: 'agent_outdated', severity: 'block', text: 'An old robot agent (pid 5150) runs older code. Stop it, then Start.', source: 'server' }
      : { code: 'bringup_foreign:agent', severity: 'block', text: 'An old agent process is running (pid 5150). Adopt or leave it.', source: 'server' },
  };
}

describe('Take control from the panel (D3)', () => {
  it('a blocked arm switch offers Take control; it takes, then opens the arm-control confirmation', async () => {
    serve(readinessFor(ROBOT, 'read_only_ready'));
    const bodies: unknown[] = [];
    server.use(
      http.post(`/api/robots/${ROBOT}/bringup/sidecar-mode`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ ok: true });
      }),
    );
    let bound = false;
    const take = vi.fn(async () => {
      bound = true;
      return true;
    });
    const lease = (): ReadinessLease => ({ enabled: true, state: bound ? 'bound' : 'observing', grant: () => (bound ? GRANT : null), take });
    const { rerender } = render(<RobotReadinessPanel robotId={ROBOT} lease={lease()} />);
    expect(await screen.findByTestId('readiness-arm-control')).toBeDisabled();
    expect(screen.queryByTestId('readiness-arm-blocked')).toBeNull();
    fireEvent.click(screen.getByTestId('readiness-take-control'));
    await waitFor(() => expect(take).toHaveBeenCalledTimes(1));
    // The page re-renders with the bound lease, as TeleopTab's onLeaseChange does.
    rerender(<RobotReadinessPanel robotId={ROBOT} lease={lease()} />);
    const dialog = await screen.findByTestId('readiness-arm-confirm');
    expect(dialog).toHaveTextContent('arm_sdk');
    expect(bodies).toEqual([]);
    fireEvent.click(screen.getByTestId('readiness-arm-confirm-confirm'));
    await waitFor(() => expect(bodies).toEqual([{ mode: 'arm_sdk', confirm: true, ...GRANT }]));
    expect(screen.queryByTestId('readiness-take-control')).toBeNull();
  });

  it('a failed take says so and opens nothing', async () => {
    serve(readinessFor(ROBOT, 'read_only_ready'));
    const take = vi.fn(async () => false);
    render(<RobotReadinessPanel robotId={ROBOT} lease={{ enabled: true, state: 'observing', grant: () => null, take }} />);
    fireEvent.click(await screen.findByTestId('readiness-take-control'));
    expect(await screen.findByTestId('readiness-error')).toHaveTextContent('Could not take control');
    expect(screen.queryByTestId('readiness-arm-confirm')).toBeNull();
  });

  it('without take (or with leases off) the panel keeps its text', async () => {
    serve(readinessFor(ROBOT, 'read_only_ready'));
    const { unmount } = render(<RobotReadinessPanel robotId={ROBOT} lease={{ enabled: true, state: 'observing', grant: () => null }} />);
    expect(await screen.findByTestId('readiness-arm-blocked')).toHaveTextContent('Take control first');
    unmount();
    render(<RobotReadinessPanel robotId={ROBOT} lease={{ enabled: false, state: 'observing', grant: () => null, take: async () => true }} />);
    expect(await screen.findByTestId('readiness-arm-blocked')).toHaveTextContent('control leases are off');
    expect(screen.queryByTestId('readiness-take-control')).toBeNull();
  });

  it('the Stop dialog offers Take control next to Limp first, which it then enables', async () => {
    serve(readinessFor(ROBOT, 'following'));
    let bound = false;
    const take = vi.fn(async () => {
      bound = true;
      return true;
    });
    const lease = (): ReadinessLease => ({ enabled: true, state: bound ? 'bound' : 'observing', grant: () => (bound ? GRANT : null), take });
    const { rerender } = render(<RobotReadinessPanel robotId={ROBOT} lease={lease()} />);
    fireEvent.click(await screen.findByTestId('readiness-stop'));
    const dialog = await screen.findByTestId('readiness-stop-confirm');
    expect(within(dialog).getByTestId('readiness-limp-first')).toBeDisabled();
    fireEvent.click(within(dialog).getByTestId('readiness-limp-take-control'));
    await waitFor(() => expect(take).toHaveBeenCalledTimes(1));
    rerender(<RobotReadinessPanel robotId={ROBOT} lease={lease()} />);
    await waitFor(() => expect(within(screen.getByTestId('readiness-stop-confirm')).getByTestId('readiness-limp-first')).toBeEnabled());
    expect(screen.queryByTestId('readiness-limp-take-control')).toBeNull();
  });
});

describe('Foreign and stale robot-side processes', () => {
  it('a current foreign agent shows its start time and cwd, with Adopt', async () => {
    serve(foreignAgent(false));
    render(<RobotReadinessPanel robotId={ROBOT} lease={BOUND} />);
    const box = await screen.findByTestId('readiness-foreign-agent');
    expect(box).toHaveTextContent(`started ${shortDateTime(STALE.startedAt)}`);
    expect(box).toHaveTextContent('old-tree/robot-agent/');
    expect(box).toHaveTextContent('robot sim-g1-edu-dev');
    expect(within(box).getByRole('button', { name: 'Adopt' })).toBeInTheDocument();
    expect(screen.queryByTestId('readiness-stale-agent')).toBeNull();
  });

  it('a stale foreign agent: no Adopt, "Runs code from before", the stop command, and the row is highlighted', async () => {
    serve(foreignAgent(true));
    render(<RobotReadinessPanel robotId={ROBOT} lease={BOUND} />);
    await waitFor(() => expect(screen.getByTestId('readiness-reason')).toHaveAttribute('data-code', 'agent_outdated'));
    const box = await screen.findByTestId('readiness-foreign-agent');
    expect(within(box).queryByRole('button', { name: 'Adopt' })).toBeNull();
    expect(within(box).getByRole('button', { name: 'Leave' })).toBeInTheDocument();
    const stale = within(box).getByTestId('readiness-stale-agent');
    expect(stale).toHaveTextContent(`Runs code from before ${shortDateTime(STALE.codeAt)}. Stop it, then press Start.`);
    expect(stale).toHaveTextContent('kill -TERM 5150');
    expect(screen.getByTestId('readiness-row-agent')).toHaveAttribute('data-highlighted', 'true');
    expect(screen.getByTestId('readiness-row-agent')).toHaveAttribute('data-status', 'fail');
  });

  it('hides Adopt for stale code even when the supervisor still offered it', () => {
    const snap = foreignAgent(true);
    const step = snap.bringup!.steps.find((s) => s.id === 'agent')!;
    const row = readinessRows({ ...snap, bringup: { ...snap.bringup!, steps: snap.bringup!.steps.map((s) => (s.id === 'agent' ? { ...step, actions: ['adopt', 'leave'] } : s)) } })
      .find((r) => r.id === 'agent')!;
    render(<ul><ReadinessRow row={row} onAdopt={() => undefined} onLeave={() => undefined} /></ul>);
    expect(screen.queryByTestId('readiness-adopt-agent')).toBeNull();
  });

  it('an owned process older than its code fails its row; agent_outdated points at it', () => {
    const snap = readinessFor(ROBOT, 'following');
    const steps = snap.bringup!.steps.map((s) =>
      s.id === 'sidecar' ? { ...s, state: 'warn' as const, code: 'stale_code', checks: { ...s.checks, staleCode: STALE } } : s,
    );
    const r: RobotReadiness = {
      ...snap,
      bringup: { ...snap.bringup!, steps },
      reason: { code: 'agent_outdated', severity: 'block', text: 'The sidecar runs older code than NeoDEM. Restart the robot side.', source: 'server' },
    };
    const row = readinessRows(r).find((x) => x.id === 'sidecar')!;
    expect(row.status).toBe('fail');
    expect(row.value).toBe(`runs code from before ${shortDateTime(STALE.codeAt)}`);
    expect(reasonRow(r)).toBe('sidecar');
  });

  it('an outdated agent without a supervisor verdict reads as older code on the agent row', () => {
    const snap = readinessFor(ROBOT, 'following');
    const r: RobotReadiness = {
      ...snap,
      agent: { reachable: true, error: 'HTTP 404 (no readiness route)', readiness: null, outdated: true },
      reason: { code: 'agent_outdated', severity: 'block', text: 'The robot agent runs older code than NeoDEM. Restart the robot side.', source: 'server' },
    };
    const row = readinessRows(r).find((x) => x.id === 'agent')!;
    expect(row).toMatchObject({ status: 'fail', value: 'older code than NeoDEM' });
    expect(reasonRow(r)).toBe('agent');
  });

  it('helpers: short cwd, the SIGTERM stop command, local date-time', () => {
    expect(shortCwd('/home/op/develop/robot-management-system/robot-agent')).toBe('robot-management-system/robot-agent/');
    expect(shortCwd(null)).toBeNull();
    expect(stopCommand(5150)).toBe('kill -TERM 5150');
    expect(stopCommand(null)).toBeNull();
    expect(shortDateTime('2026-10-17T15:21:00.000Z')).toMatch(/^2026-10-1[78] \d\d:\d\d$/);
  });
});

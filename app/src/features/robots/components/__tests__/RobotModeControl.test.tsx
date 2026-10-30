/**
 * @file RobotModeControl.test.tsx
 * @description The robot-mode control (TASK-398): the disabled-reason
 *              precedence table, a confirmation before every POST, the lease
 *              read at click time, and the red "not confirmed" answer with
 *              focus on Limp.
 * @feature robots
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import {
  RobotModeControl,
  bringUpNext,
  modeDisabledReason,
  modeLabel,
  type ModeReasonContext,
} from '../RobotModeControl';
import type { BaseModeStatus, BaseModeResult } from '../../api/baseModeApi';
import type { UseRobotBaseModeReturn } from '../../hooks/useRobotBaseMode';

function status(over: Partial<BaseModeStatus> = {}, base: Partial<NonNullable<BaseModeStatus['base']>> = {}): BaseModeStatus {
  return {
    capability: { gate: 'fsm', moveEnabled: false, idsVerified: false, ids: null },
    base: { fsmId: 1, mode: 'limp', ageS: 0.2, error: null, ...base },
    inFlight: null,
    estopLatched: false,
    sidecarEstopLatched: false,
    armed: false,
    ...over,
  };
}

function ctx(over: Partial<ModeReasonContext> = {}): ModeReasonContext {
  return { status: status(), needsControl: false, armsEngaged: false, pending: false, standHeldS: null, ...over };
}

describe('modeDisabledReason — the precedence table', () => {
  it('1. mode control off beats everything', () => {
    const c = ctx({
      status: status({ capability: { gate: 'off', moveEnabled: false, idsVerified: false, ids: null }, estopLatched: true }),
      needsControl: true,
    });
    for (const m of ['limp', 'stand', 'balance'] as const) {
      expect(modeDisabledReason(m, c)).toBe("Mode control is off on this robot's sidecar.");
    }
    expect(modeDisabledReason('limp', ctx({ status: null }))).toMatch(/Mode control is off/);
  });

  it('0. an unreachable sidecar says so instead of "mode control is off" (TASK-411)', () => {
    const c = ctx({
      status: status({ capability: { gate: 'unknown', moveEnabled: null, idsVerified: false, ids: null }, sidecarReachable: false }),
    });
    for (const m of ['limp', 'stand', 'balance'] as const) {
      expect(modeDisabledReason(m, c)).toBe("Can't reach the robot sidecar. Start the robot side.");
    }
    // Reachable (or not reported) keeps the old line for a gate that really is off.
    const off = ctx({ status: status({ capability: { gate: 'unknown', moveEnabled: null, idsVerified: false, ids: null }, sidecarReachable: true }) });
    expect(modeDisabledReason('stand', off)).toBe("Mode control is off on this robot's sidecar.");
  });

  it('2. an unknown mode, with the sidecar reason — but Limp stays available', () => {
    const c = ctx({ status: status({}, { mode: 'unknown', fsmId: null, error: 'sport service not answering' }), needsControl: true });
    expect(modeDisabledReason('stand', c)).toBe('The robot mode is unknown — sport service not answering.');
    expect(modeDisabledReason('balance', c)).toMatch(/unknown/);
    expect(modeDisabledReason('limp', c)).toBe('Take control first.');
  });

  it('3. take control first', () => {
    const c = ctx({ needsControl: true, status: status({ estopLatched: true }) });
    expect(modeDisabledReason('stand', c)).toBe('Take control first.');
    expect(modeDisabledReason('limp', c)).toBe('Take control first.');
  });

  it('4. reset the E-stop first — not for Limp', () => {
    const c = ctx({ status: status({ sidecarEstopLatched: true }), armsEngaged: true });
    expect(modeDisabledReason('stand', c)).toBe('Reset the E-stop first.');
    expect(modeDisabledReason('balance', c)).toBe('Reset the E-stop first.');
    expect(modeDisabledReason('limp', c)).toBeNull();
  });

  it('5. release the grip while the arms are engaged — Stand up and Balance only', () => {
    const c = ctx({ status: status({}, { mode: 'stand', fsmId: 4 }), armsEngaged: true });
    expect(modeDisabledReason('stand', c)).toBe('Release the grip; arms are engaged.');
    expect(modeDisabledReason('balance', c)).toBe('Release the grip; arms are engaged.');
    expect(modeDisabledReason('limp', c)).toBeNull();
    expect(modeDisabledReason('balance', ctx({ status: status({ armed: true }, { mode: 'stand' }) })))
      .toBe('Release the grip; arms are engaged.');
  });

  it('6. stand up needs limp', () => {
    expect(modeDisabledReason('stand', ctx({ status: status({}, { mode: 'balance', fsmId: 500 }) })))
      .toBe('Stand up needs Limp.');
    expect(modeDisabledReason('stand', ctx())).toBeNull();
  });

  it('6b. from zero torque, Stand up says to press Limp first (TASK-423)', () => {
    const zt = ctx({ status: status({}, { mode: 'zero_torque', fsmId: 0 }) });
    expect(modeDisabledReason('stand', zt)).toBe('The robot is in zero torque — press Limp first, then Stand up.');
    expect(modeDisabledReason('limp', zt)).toBeNull();
  });

  it('7. balance needs stand, then the settle time', () => {
    expect(modeDisabledReason('balance', ctx())).toBe('Balance needs Stand.');
    const standing = status({}, { mode: 'stand', fsmId: 4 });
    expect(modeDisabledReason('balance', ctx({ status: standing, standHeldS: 0.5 })))
      .toBe('Balance needs Stand — wait 1.5 s more.');
    expect(modeDisabledReason('balance', ctx({ status: standing, standHeldS: 2.5 }))).toBeNull();
  });

  it('3b. leases off on the server: no lease can be taken, and the reason says so', () => {
    const c = ctx({ needsControl: true, leasesOff: true });
    for (const m of ['limp', 'stand', 'balance'] as const) {
      expect(modeDisabledReason(m, c)).toBe(
        'Mode changes need a control lease, and control leases are off on this server.',
      );
    }
  });

  it('8. a change in progress — but Limp stays available to preempt it', () => {
    expect(modeDisabledReason('stand', ctx({ pending: true }))).toBe('A change is in progress.');
    const standing = status({ inFlight: 'balance' }, { mode: 'stand', fsmId: 4 });
    expect(modeDisabledReason('balance', ctx({ status: standing, standHeldS: 3 }))).toBe('A change is in progress.');
    expect(modeDisabledReason('limp', ctx({ status: status({ inFlight: 'stand' }) }))).toBeNull();
    expect(modeDisabledReason('limp', ctx({ status: standing, pending: true }))).toBeNull();
  });

  it('labels the measured modes', () => {
    expect(modeLabel('stand', 4)).toBe('Stand (locked)');
    expect(modeLabel('other', 801)).toBe('Other (801)');
    expect(modeLabel('zero_torque', 0)).toBe('Zero torque');
  });
});

function fakeHook(over: Partial<UseRobotBaseModeReturn> = {}): UseRobotBaseModeReturn {
  return {
    status: status(),
    readError: null,
    readAt: Date.now(),
    standSince: null,
    pending: null,
    lastResult: null,
    request: vi.fn(async (): Promise<BaseModeResult> => ({ ok: true, status: 200, fsmId: 4, tookMs: 300 })),
    refresh: vi.fn(async () => {}),
    ...over,
  };
}

const BOUND = { enabled: true, state: 'bound', grant: () => ({ leaseId: 'secret', generation: 9 }) };

describe('RobotModeControl', () => {
  it('shows the measured mode and why each disabled button is disabled, as text', () => {
    render(<RobotModeControl robotId="r1" lease={{ ...BOUND, state: 'observing' }} baseMode={fakeHook()} />);
    expect(screen.getByTestId('robot-mode-readout')).toHaveTextContent('Limp');
    expect(screen.getByTestId('robot-mode-stand')).toBeDisabled();
    expect(screen.getByTestId('robot-mode-reasons')).toHaveTextContent('Stand up: Take control first.');
  });

  it('says the sidecar cannot be reached when the server reports sidecarReachable:false (TASK-411)', () => {
    const unreachable = status({ capability: { gate: 'unknown', moveEnabled: null, idsVerified: false, ids: null }, sidecarReachable: false });
    render(<RobotModeControl robotId="r1" lease={BOUND} baseMode={fakeHook({ status: unreachable })} />);
    expect(screen.getByTestId('robot-mode-reasons')).toHaveTextContent("Can't reach the robot sidecar. Start the robot side.");
    expect(screen.getByTestId('robot-mode-reasons')).not.toHaveTextContent('Mode control is off');
  });

  it('with leases off on the server, every button is disabled and says why', () => {
    render(<RobotModeControl robotId="r1" lease={{ enabled: false, state: 'idle', grant: () => null }} baseMode={fakeHook()} />);
    for (const id of ['robot-mode-limp', 'robot-mode-stand', 'robot-mode-balance']) {
      expect(screen.getByTestId(id)).toBeDisabled();
    }
    expect(screen.getByTestId('robot-mode-reasons')).toHaveTextContent('control leases are off on this server');
  });

  it('keeps Limp clickable while this console waits on a Balance', () => {
    const hook = fakeHook({
      status: status({ inFlight: 'balance' }, { mode: 'stand', fsmId: 4 }),
      pending: 'balance',
    });
    render(<RobotModeControl robotId="r1" lease={BOUND} baseMode={hook} />);
    expect(screen.getByTestId('robot-mode-limp')).toBeEnabled();
    expect(screen.getByTestId('robot-mode-balance')).toBeDisabled();
  });

  it('asks for confirmation before it posts, then posts with the lease read at click time', async () => {
    const hook = fakeHook();
    const grant = vi.fn(() => ({ leaseId: 'secret', generation: 9 }));
    render(<RobotModeControl robotId="r1" lease={{ ...BOUND, grant }} baseMode={hook} />);

    fireEvent.click(screen.getByTestId('robot-mode-stand'));
    expect(hook.request).not.toHaveBeenCalled();
    expect(grant).not.toHaveBeenCalled();
    expect(screen.getByText(/Legs stiffen and lock in a standing pose/)).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByTestId('robot-mode-confirm-confirm'));
    });
    expect(hook.request).toHaveBeenCalledWith('stand', { leaseId: 'secret', generation: 9 });
  });

  it('cancelling the confirmation posts nothing', () => {
    const hook = fakeHook();
    render(<RobotModeControl robotId="r1" lease={BOUND} baseMode={hook} />);
    fireEvent.click(screen.getByTestId('robot-mode-limp'));
    expect(screen.getByText(/sags into the gantry/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('robot-mode-confirm-cancel'));
    expect(hook.request).not.toHaveBeenCalled();
  });

  it('renders an unconfirmed change in red with the measured mode, and focuses Limp', () => {
    const hook = fakeHook({
      status: status({}, { mode: 'stand', fsmId: 4 }),
      lastResult: {
        ok: false, status: 504, code: 'unconfirmed', error: 'not reported',
        measured: { fsmId: 4, mode: 'stand', ageS: 0.1, error: null },
      },
    });
    render(<RobotModeControl robotId="r1" lease={BOUND} baseMode={hook} />);
    const err = screen.getByTestId('robot-mode-error');
    expect(err).toHaveTextContent('Not confirmed — the robot reports Stand (locked). Use Limp if in doubt.');
    expect(err.className).toMatch(/text-signal-stopped/);
    expect(document.activeElement).toBe(screen.getByTestId('robot-mode-limp'));
  });

  it('shows the sidecar hint under an unconfirmed balance (TASK-422)', () => {
    const hint = 'the robot still reports FSM 4 — if this G1 has the 3-DoF waist, it balances in FSM 501, not 500: set G1_FSM_ID_BALANCE=501 in its profile';
    const hook = fakeHook({
      status: status({}, { mode: 'stand', fsmId: 4 }),
      lastResult: {
        ok: false, status: 504, code: 'unconfirmed', error: `not reported; ${hint}`, hint,
        measured: { fsmId: 4, mode: 'stand', ageS: 0.1, error: null },
      },
    });
    render(<RobotModeControl robotId="r1" lease={BOUND} baseMode={hook} />);
    expect(screen.getByTestId('robot-mode-error')).toHaveTextContent('Not confirmed — the robot reports Stand (locked).');
    expect(screen.getByTestId('robot-mode-hint')).toHaveTextContent(hint);
  });

  it('shows no hint when the result carries none', () => {
    const hook = fakeHook({
      lastResult: {
        ok: false, status: 504, code: 'unconfirmed', error: 'not reported',
        measured: { fsmId: 4, mode: 'stand', ageS: 0.1, error: null },
      },
    });
    render(<RobotModeControl robotId="r1" lease={BOUND} baseMode={hook} />);
    expect(screen.queryByTestId('robot-mode-hint')).toBeNull();
  });

  it('shows any other refusal with its code', () => {
    const hook = fakeHook({
      lastResult: { ok: false, status: 409, code: 'bad_transition', error: 'balance is only allowed from stand' },
    });
    render(<RobotModeControl robotId="r1" lease={BOUND} baseMode={hook} />);
    expect(screen.getByTestId('robot-mode-error')).toHaveTextContent('bad_transition: balance is only allowed from stand');
  });
});

describe('bring-up sequence (TASK-423)', () => {
  it('names the next button from each measured mode, and none when the mode is unknown', () => {
    expect(bringUpNext('zero_torque')?.mode).toBe('limp');
    expect(bringUpNext('other')?.mode).toBe('limp');
    expect(bringUpNext('limp')?.mode).toBe('stand');
    expect(bringUpNext('stand')?.mode).toBe('balance');
    expect(bringUpNext('balance')).toEqual({ mode: null, text: expect.stringMatching(/Bring-up done/) });
    expect(bringUpNext('unknown')).toBeNull();
  });

  it('shows the step the robot is in and the next one, and marks only that button — clicking still confirms', () => {
    const hook = fakeHook({ status: status({}, { mode: 'zero_torque', fsmId: 0 }) });
    render(<RobotModeControl robotId="r1" lease={BOUND} baseMode={hook} />);
    const strip = screen.getByTestId('robot-bringup');
    expect(strip.querySelector('[data-current="true"]')).toHaveTextContent('Zero torque');
    expect(screen.getByTestId('robot-bringup-next')).toHaveTextContent('Next: press Limp, then Stand up, then Balance.');
    expect(screen.getByTestId('robot-mode-limp')).toHaveAttribute('data-next', 'true');
    expect(screen.getByTestId('robot-mode-stand')).not.toHaveAttribute('data-next');
    expect(screen.getByTestId('robot-mode-reasons')).toHaveTextContent('press Limp first, then Stand up');
    fireEvent.click(screen.getByTestId('robot-mode-limp'));
    expect(hook.request).not.toHaveBeenCalled();
    expect(screen.getByText(/sags into the gantry/)).toBeInTheDocument();
  });

  it('is hidden while mode control is off', () => {
    const off = status({ capability: { gate: 'off', moveEnabled: false, idsVerified: false, ids: null } });
    render(<RobotModeControl robotId="r1" lease={BOUND} baseMode={fakeHook({ status: off })} />);
    expect(screen.queryByTestId('robot-bringup')).toBeNull();
  });
});

describe('RobotModeControl — asking the headset (TASK-417)', () => {
  const HELD_ELSEWHERE = { enabled: true, state: 'observing', grant: () => null };

  it('offers Stand up as "Ask the headset" while the headset holds the lease; Limp stays lease-gated', () => {
    const ask = vi.fn();
    render(<RobotModeControl robotId="r1" lease={HELD_ELSEWHERE} baseMode={fakeHook()} requestFromHolder={ask} />);
    expect(screen.getByTestId('robot-mode-stand')).toBeEnabled();
    expect(screen.getByTestId('robot-mode-stand')).toHaveTextContent('Ask the headset: Stand up');
    // Balance needs Stand first — its real reason, not "Take control first".
    expect(screen.getByTestId('robot-mode-balance')).toBeDisabled();
    expect(screen.getByTestId('robot-mode-balance')).toHaveTextContent(/^Balance$/);
    expect(screen.getByTestId('robot-mode-reasons')).toHaveTextContent('Balance: Balance needs Stand.');
    expect(screen.getByTestId('robot-mode-limp')).toBeDisabled();
    expect(screen.getByTestId('robot-mode-reasons')).toHaveTextContent('Limp: Take control first.');
  });

  it('without a headset to ask, nothing changes: "Take control first"', () => {
    render(<RobotModeControl robotId="r1" lease={HELD_ELSEWHERE} baseMode={fakeHook()} />);
    expect(screen.getByTestId('robot-mode-stand')).toBeDisabled();
    expect(screen.getByTestId('robot-mode-stand')).toHaveTextContent(/^Stand up$/);
  });

  it('holding the lease itself, the console posts directly and never asks', () => {
    const ask = vi.fn();
    render(<RobotModeControl robotId="r1" lease={BOUND} baseMode={fakeHook()} requestFromHolder={ask} />);
    expect(screen.getByTestId('robot-mode-stand')).toHaveTextContent(/^Stand up$/);
  });

  it('never offers the ask during a latched E-stop', () => {
    const ask = vi.fn();
    render(
      <RobotModeControl robotId="r1" lease={HELD_ELSEWHERE} baseMode={fakeHook({ status: status({ estopLatched: true }) })} requestFromHolder={ask} />,
    );
    expect(screen.getByTestId('robot-mode-stand')).toBeDisabled();
    expect(screen.getByTestId('robot-mode-reasons')).toHaveTextContent('Stand up: Reset the E-stop first.');
  });

  it('confirms first, says the operator confirms in the headset, waits with a countdown, then shows the outcome', async () => {
    let answer!: (r: { outcome: 'allowed' }) => void;
    const ask = vi.fn(() => new Promise<{ outcome: 'allowed' }>((resolve) => { answer = resolve; }));
    const hook = fakeHook({ status: status({}, { mode: 'stand', fsmId: 4 }), standSince: Date.now() - 5_000 });
    render(<RobotModeControl robotId="r1" lease={HELD_ELSEWHERE} baseMode={hook} requestFromHolder={ask} />);

    fireEvent.click(screen.getByTestId('robot-mode-balance'));
    expect(ask).not.toHaveBeenCalled();
    expect(screen.getByText(/The operator confirms in the headset\./)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByTestId('robot-mode-confirm-confirm'));
    });
    expect(ask).toHaveBeenCalledWith('balance');
    expect(hook.request).not.toHaveBeenCalled();
    expect(screen.getByTestId('robot-mode-asking')).toHaveTextContent(/Waiting for the operator… \(\d+ s\)/);
    expect(screen.getByTestId('robot-mode-balance')).toBeDisabled();

    await act(async () => { answer({ outcome: 'allowed' }); });
    expect(screen.queryByTestId('robot-mode-asking')).toBeNull();
    expect(screen.getByTestId('robot-mode-answer')).toHaveTextContent('The operator allowed Balance.');
    expect(hook.refresh).toHaveBeenCalled();
  });

  it('says so when the operator lets the request expire', async () => {
    const ask = vi.fn(async () => ({ outcome: 'expired' as const }));
    render(<RobotModeControl robotId="r1" lease={HELD_ELSEWHERE} baseMode={fakeHook()} requestFromHolder={ask} />);
    fireEvent.click(screen.getByTestId('robot-mode-stand'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('robot-mode-confirm-confirm'));
    });
    const line = screen.getByTestId('robot-mode-answer');
    expect(line).toHaveAttribute('data-outcome', 'expired');
    expect(line).toHaveTextContent('The operator did not answer within 10 s.');
  });
});

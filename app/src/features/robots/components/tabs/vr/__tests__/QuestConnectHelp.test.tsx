/**
 * @file QuestConnectHelp.test.tsx
 * @description TASK-393: the "Connect Meta Quest" walkthrough — the steps in
 *              order, the one command and the headset URL derived from the
 *              page, open by itself only when the page cannot do WebXR.
 *              TASK-412: with a supervisor, the headset's live state, Connect,
 *              Open on headset and Copy viewer link instead.
 * @feature robots
 */

import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QuestConnectHelp, questConnectSteps } from '../QuestConnectHelp';
import { sessionIdFromLocation } from '../vrAvailability';
import { useReadinessStore } from '../../../../store/readinessStore';
import type { QuestReport } from '../../../../api/readinessApi';

const loc = { protocol: 'http:', hostname: '192.168.1.20', port: '1420', pathname: '/robots/g1', search: '?tab=vr', hash: '' };

describe('questConnectSteps', () => {
  it('walks from developer mode to entering VR', () => {
    expect(questConnectSteps(loc).map((s) => s.id)).toEqual(['dev-mode', 'usb', 'allow', 'script', 'open', 'drive']);
  });

  it('gives the script and a localhost URL on the same port and path', () => {
    const steps = questConnectSteps(loc);
    expect(steps.find((s) => s.id === 'script')?.copy?.text).toBe('./scripts/quest-connect.sh');
    expect(steps.find((s) => s.id === 'open')?.copy?.text).toBe('http://localhost:1420/robots/g1?tab=vr');
  });

  it('passes a non-default port to the script', () => {
    const steps = questConnectSteps({ ...loc, port: '1430' });
    expect(steps.find((s) => s.id === 'script')?.copy?.text).toBe('./scripts/quest-connect.sh --port 1430');
  });
});

describe('QuestConnectHelp', () => {
  it('opens itself on an insecure origin', () => {
    render(<QuestConnectHelp location={loc} isSecureContext={false} hasXr={false} />);
    expect(screen.getByTestId('quest-connect-help')).toHaveAttribute('open');
    expect(screen.getByText('not a secure context')).toBeInTheDocument();
  });

  it('stays collapsed when the page can already reach a headset', () => {
    render(<QuestConnectHelp location={loc} isSecureContext hasXr />);
    expect(screen.getByTestId('quest-connect-help')).not.toHaveAttribute('open');
  });
});

// ============================================================================
// TASK-412 — live status and buttons when the supervisor reports the Quest
// ============================================================================

describe('QuestConnectHelp with a supervisor (TASK-412)', () => {
  const ROBOT = 'g1-edu-4';
  const SESSION = '0b6f1c2e-9a4d-4f5e-8c1b-2d3e4f5a6b7c';
  const device = { serial: '2G0YC5ZG8X0123', state: 'device' as const, model: 'Quest 3' };
  const report = (over: Partial<QuestReport> = {}): QuestReport => ({
    adb: '/home/op/platform-tools/adb', devices: [device], reversed: [], hint: null, ...over,
  });
  const ok = (body: Record<string, unknown> = {}) => ({ ok: true as const, status: 200, body });

  it('shows the live state for each headset state', () => {
    const cases: Array<[QuestReport, RegExp]> = [
      [report({ reversed: [{ remote: 'tcp:1420', local: 'tcp:1420' }] }), /Quest 3 \(serial 2G0Y…0123\) connected · port 1420 forwarded/],
      [report(), /Quest 3 \(serial 2G0Y…0123\) connected$/],
      [report({ devices: [{ ...device, state: 'unauthorized', model: null }] }), /Put on the headset and allow USB debugging/],
      [report({ devices: [] }), /No headset on USB/],
    ];
    for (const [quest, text] of cases) {
      const { unmount } = render(<QuestConnectHelp location={loc} robotId={ROBOT} quest={quest} />);
      expect(screen.getByTestId('quest-connect-help')).toHaveAttribute('data-mode', 'live');
      expect(screen.getByTestId('quest-live-status').textContent).toMatch(text);
      expect(screen.queryByTestId('quest-step-script')).toBeNull();
      unmount();
    }
  });

  it('disables the buttons without a usable headset', () => {
    render(<QuestConnectHelp location={loc} robotId={ROBOT} quest={report({ devices: [{ ...device, state: 'unauthorized' }] })} />);
    expect(screen.getByTestId('quest-connect')).toBeDisabled();
    expect(screen.getByTestId('quest-open')).toBeDisabled();
  });

  it('Connect reverses this page port; Open connects first, then opens the live path', async () => {
    const questConnect = vi.fn().mockResolvedValue(ok());
    const questOpen = vi.fn().mockResolvedValue(ok());
    render(<QuestConnectHelp location={loc} robotId={ROBOT} quest={report()} questApi={{ questConnect, questOpen }} />);
    fireEvent.click(screen.getByTestId('quest-connect'));
    await waitFor(() => expect(questConnect).toHaveBeenCalledWith(ROBOT, 1420));
    await waitFor(() => expect(screen.getByTestId('quest-connect')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('quest-open'));
    await waitFor(() => expect(questOpen).toHaveBeenCalledWith(ROBOT, `/data-collection/live?robot=${ROBOT}`, 1420));
    expect(questConnect).toHaveBeenCalledTimes(2);
    expect(await screen.findByTestId('quest-message')).toHaveTextContent('press Enter VR');
  });

  it('Open on a forwarded headset does not reconnect; a refusal is shown', async () => {
    const questConnect = vi.fn().mockResolvedValue(ok());
    const questOpen = vi.fn().mockResolvedValue({ ok: false, status: 502, code: 'open_failed', error: 'adb: device offline' });
    render(
      <QuestConnectHelp
        location={{ ...loc, port: '1442' }}
        robotId={ROBOT}
        quest={report({ reversed: [{ remote: 'tcp:1442', local: 'tcp:1442' }] })}
        questApi={{ questConnect, questOpen }}
      />,
    );
    fireEvent.click(screen.getByTestId('quest-open'));
    await waitFor(() => expect(questOpen).toHaveBeenCalledWith(ROBOT, `/data-collection/live?robot=${ROBOT}`, 1442));
    expect(questConnect).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toHaveTextContent('adb: device offline');
  });

  it('offers Copy viewer link on a session page only', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { unmount } = render(<QuestConnectHelp location={loc} robotId={ROBOT} quest={report()} />);
    expect(screen.queryByTestId('quest-copy-viewer-link')).toBeNull();
    unmount();
    render(<QuestConnectHelp location={{ ...loc, pathname: `/data-collection/${SESSION}`, search: '' }} robotId={ROBOT} quest={report()} />);
    fireEvent.click(screen.getByTestId('quest-copy-viewer-link'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/data-collection/${SESSION}`));
  });

  it('keeps the copy-the-command help without a supervisor', () => {
    render(<QuestConnectHelp location={loc} robotId={ROBOT} quest={null} isSecureContext hasXr />);
    expect(screen.getByTestId('quest-connect-help')).toHaveAttribute('data-mode', 'manual');
    expect(screen.getByTestId('quest-step-script')).toBeInTheDocument();
  });

  it('reads the report from the readiness store when not passed', () => {
    useReadinessStore.getState().reset();
    render(<QuestConnectHelp location={loc} robotId={ROBOT} />);
    expect(screen.getByTestId('quest-connect-help')).toHaveAttribute('data-mode', 'manual');
  });
});

describe('sessionIdFromLocation', () => {
  it('reads the session id off the path or the demo hash route', () => {
    const id = '0b6f1c2e-9a4d-4f5e-8c1b-2d3e4f5a6b7c';
    expect(sessionIdFromLocation({ ...loc, pathname: `/data-collection/${id}` })).toBe(id);
    expect(sessionIdFromLocation({ ...loc, pathname: `/data-collection/record/${id}` })).toBe(id);
    expect(sessionIdFromLocation({ ...loc, pathname: '/', hash: `#/data-collection/${id}?x=1` })).toBe(id);
    expect(sessionIdFromLocation({ ...loc, pathname: '/data-collection/live' })).toBeNull();
    expect(sessionIdFromLocation(loc)).toBeNull();
  });
});

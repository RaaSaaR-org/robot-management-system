/**
 * @file SessionCommandBar.test.tsx
 * @description The command bar (TASK-426): the E-STOP alone in its zone in
 *              every phase, the normal actions on the left per phase, the
 *              Testing tools popover kept mounted, and presence deduped.
 * @feature datacollection
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/utils';
import { SessionCommandBar, type SessionCommandBarProps } from '../SessionCommandBar';
import { dedupeViewers } from '../../PresenceBar';
import type { PresenceViewer } from '../../../types/datacollection.types';

const viewers: PresenceViewer[] = [
  { userId: 'u1', displayName: 'Anna Keller', role: 'operator', since: '2026-10-30T10:00:00Z' },
  { userId: 'u2', displayName: 'Ben Hoffmann', role: 'assistant', since: '2026-10-30T10:00:01Z' },
  { userId: 'u2', displayName: 'Ben Hoffmann', role: 'assistant', since: '2026-10-30T10:00:09Z' },
];

const base: SessionCommandBarProps = {
  phase: 'record',
  tally: 'rec',
  title: 'Pick up the apple and place it on the plate',
  status: 'recording',
  robotName: 'G1-EDU-4',
  link: 'live',
  inputLabel: 'Meta Quest VR',
  fps: 30,
  viewers,
  onToggleMute: vi.fn(),
  onEnd: vi.fn(),
  tools: <div data-testid="tool-row">a tool</div>,
  estop: <button type="button" data-testid="session-estop">E-STOP</button>,
};

const render = (over: Partial<SessionCommandBarProps> = {}) => renderWithProviders(<SessionCommandBar {...base} {...over} />);

describe('SessionCommandBar', () => {
  it.each([
    ['setup', 'created'],
    ['record', 'recording'],
    ['record', 'paused'],
    ['wrap', 'completed'],
    ['wrap', 'failed'],
  ] as const)('holds exactly one E-STOP, alone in its zone, in %s (%s)', (phase, status) => {
    render({ phase, status });
    expect(screen.getAllByTestId('session-estop')).toHaveLength(1);
    const zone = screen.getByTestId('estop-zone');
    expect(within(zone).getAllByRole('button')).toEqual([screen.getByTestId('session-estop')]);
  });

  it('puts mute and End session in the left group in Record only', () => {
    const { unmount } = render({ phase: 'record' });
    const actions = screen.getByTestId('session-actions');
    expect(within(actions).getByTestId('hud-mute')).toBeInTheDocument();
    expect(within(actions).getByTestId('session-end')).toHaveAccessibleName('End session');
    expect(within(actions).getByTestId('session-tools-toggle')).toBeInTheDocument();
    unmount();

    render({ phase: 'setup', status: 'created', tally: 'setup' });
    expect(screen.queryByTestId('hud-mute')).toBeNull();
    expect(screen.queryByTestId('session-end')).toBeNull();
    expect(screen.getByTestId('session-tools-toggle')).toBeInTheDocument();
  });

  it('keeps End disabled and says the robot is saving while the End request is out (TASK-450)', () => {
    const onEnd = vi.fn();
    render({ onEnd, endPending: true });
    const end = screen.getByTestId('session-end');
    expect(end).toBeDisabled();
    expect(end).toHaveTextContent('Saving takes on the robot…');
    fireEvent.click(end);
    expect(onEnd).not.toHaveBeenCalled();
  });

  it('has no left group, no tools toggle and no robot link dot in Wrap up', () => {
    render({ phase: 'wrap', status: 'completed', tally: 'done' });
    expect(screen.queryByTestId('session-actions')).toBeNull();
    expect(screen.queryByTestId('hud-mute')).toBeNull();
    expect(screen.queryByTestId('session-tools-toggle')).toBeNull();
    expect(screen.queryByTestId('robot-link')).toBeNull();
  });

  it('toggles the mute through its handler, with aria-pressed', () => {
    const onToggleMute = vi.fn();
    render({ muted: true, onToggleMute });
    const mute = screen.getByTestId('hud-mute');
    expect(mute).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(mute);
    expect(onToggleMute).toHaveBeenCalledTimes(1);
  });

  it('keeps the Testing tools mounted while closed; Escape closes them and returns focus', () => {
    render();
    const panel = screen.getByTestId('session-tools');
    expect(panel).not.toBeVisible();
    expect(screen.getByTestId('tool-row')).toBeInTheDocument();
    const toggle = screen.getByTestId('session-tools-toggle');
    fireEvent.click(toggle);
    expect(panel).toBeVisible();
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(panel).not.toBeVisible();
    expect(screen.getByTestId('tool-row')).toBeInTheDocument();
    expect(toggle).toHaveFocus();
  });

  it('closes the Testing tools on an outside click', () => {
    render();
    fireEvent.click(screen.getByTestId('session-tools-toggle'));
    expect(screen.getByTestId('session-tools')).toBeVisible();
    fireEvent.pointerDown(document.body);
    expect(screen.getByTestId('session-tools')).not.toBeVisible();
  });

  it('shows the "Simulated input" tag while simulation is on', () => {
    render({ simulatedInput: true });
    expect(screen.getByTestId('sim-input-tag')).toHaveTextContent('Simulated input');
  });

  it('shows one avatar per (user, role), the headset wearer named as such', () => {
    render();
    const avatars = screen.getAllByTestId('presence-viewer');
    expect(avatars).toHaveLength(2);
    expect(avatars[0]).toHaveAttribute('title', 'Anna Keller, in the headset');
    expect(avatars[1]).toHaveAttribute('data-role', 'assistant');
    expect(dedupeViewers(viewers)).toHaveLength(2);
  });

  it('carries the tally and the full title', () => {
    render();
    expect(screen.getByTestId('session-command-bar')).toHaveAttribute('data-tally', 'rec');
    expect(screen.getByRole('heading', { level: 1 })).toHaveAttribute('title', base.title);
  });
});

/**
 * @file QuestConnectHelp.test.tsx
 * @description TASK-393: the "Connect Meta Quest" walkthrough — the steps in
 *              order, the one command and the headset URL derived from the
 *              page, open by itself only when the page cannot do WebXR.
 * @feature robots
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QuestConnectHelp, questConnectSteps } from '../QuestConnectHelp';

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

/**
 * @file ScenePanel.test.tsx
 * @description The one-line map readout (TASK-206): shown when the agent
 *              reports a map summary, absent when it reports none (older agent)
 *              or reports it disabled — an absent row must never read as "no map".
 * @feature agentmode
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ScenePanel } from '../ScenePanel';
import { useAgentModeStore } from '../../store/agentmodeStore';
import type { SceneMemory } from '../../types/agentmode.types';

const scene = (over: Partial<SceneMemory> = {}): SceneMemory => ({
  robotId: 'sim-robot-g1-edu',
  currentView: 'a table with a hat on it',
  entities: [],
  personVisible: false,
  place: null,
  updatedAt: new Date().toISOString(),
  ...over,
});

beforeEach(() => {
  useAgentModeStore.getState().reset();
});

describe('ScenePanel map summary', () => {
  it('is absent when the agent does not report a map (older agent)', () => {
    useAgentModeStore.setState({ scene: scene(), map: undefined });
    render(<ScenePanel />);
    expect(screen.queryByTestId('agent-scene-map')).toBeNull();
  });

  it('is absent when map building is disabled on the agent', () => {
    useAgentModeStore.setState({ scene: scene(), map: null });
    render(<ScenePanel />);
    expect(screen.queryByTestId('agent-scene-map')).toBeNull();
  });

  it('shows known/occupied counts and the age of the last integration', () => {
    useAgentModeStore.setState({
      scene: scene(),
      map: { knownCells: 12345, occupiedCells: 678, lastIntegratedAt: new Date().toISOString() },
    });
    render(<ScenePanel />);
    const row = screen.getByTestId('agent-scene-map');
    expect(row).toHaveTextContent(/12[,.]345 known/);
    expect(row).toHaveTextContent('678 occupied');
    expect(row).toHaveTextContent(/ago|just now|s\b/i);
  });

  it('says so when nothing has been integrated yet, instead of inventing an age', () => {
    useAgentModeStore.setState({
      scene: scene(),
      map: { knownCells: 0, occupiedCells: 0, lastIntegratedAt: null },
    });
    render(<ScenePanel />);
    expect(screen.getByTestId('agent-scene-map')).toHaveTextContent('nothing integrated yet');
  });
});

/**
 * @file CommandPanel.roles.test.tsx
 * @description The dashboard's "Command a robot" panel per role (TASK-370): a
 *              viewer gets the reason, not a command bar whose every send is a 403.
 * @feature dashboard
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { signInAs } from '@/test/utils';
import type { RobotMapMarker } from '@/features/fleet';

vi.mock('@/features/command/components/CommandBar', () => ({
  CommandBar: ({ robotName }: { robotName: string }) => <div data-testid="command-bar">{robotName}</div>,
}));

import { CommandPanel } from '../CommandPanel';

const robots = [{ robotId: 'r1', name: 'Atlas', status: 'online' }] as unknown as RobotMapMarker[];

function renderPanel() {
  return render(
    <MemoryRouter>
      <CommandPanel robots={robots} />
    </MemoryRouter>,
  );
}

describe('CommandPanel', () => {
  it('tells a viewer why there is no command bar', () => {
    signInAs('viewer');
    renderPanel();
    expect(screen.queryByTestId('command-bar')).toBeNull();
    expect(screen.getByText('View only')).toBeInTheDocument();
  });

  it.each(['member', 'owner', 'super-admin'] as const)('gives a %s the command bar', (role) => {
    signInAs(role);
    renderPanel();
    expect(screen.getByTestId('command-bar')).toHaveTextContent('Atlas');
    expect(screen.queryByText('View only')).toBeNull();
  });
});

/**
 * @file FleetMap.test.tsx
 * @description The robot popover's "Open robot's map" control is a real
 *              button for keyboard users: Enter and Space activate it.
 * @feature fleet
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FleetMap } from '../FleetMap';
import type { RobotMapMarker } from '../../types/fleet.types';

const robot: RobotMapMarker = {
  robotId: 'g1',
  name: 'Atlas',
  position: { x: 10, y: 10 },
  status: 'online',
  batteryLevel: 80,
  floor: '1',
};

function openPopover(onRobotMapClick = vi.fn()) {
  render(
    <FleetMap
      robots={[robot]}
      zones={[]}
      selectedFloor="1"
      onFloorChange={() => {}}
      onRobotMapClick={onRobotMapClick}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Atlas - online' }));
  return { onRobotMapClick, control: screen.getByTestId('fleet-open-robot-map') };
}

describe('FleetMap — Open robot\'s map control', () => {
  it('is focusable, labelled and reacts to a click', () => {
    const { onRobotMapClick, control } = openPopover();
    expect(control).toHaveAttribute('tabindex', '0');
    expect(control).toHaveAttribute('role', 'button');
    expect(control).toHaveAttribute('aria-label', "Open Atlas's map");
    fireEvent.click(control);
    expect(onRobotMapClick).toHaveBeenCalledWith('g1');
  });

  it('activates on Enter and on Space (Space is prevented from scrolling)', () => {
    const { onRobotMapClick, control } = openPopover();
    fireEvent.keyDown(control, { key: 'Enter' });
    expect(onRobotMapClick).toHaveBeenCalledTimes(1);

    const spaceEvent = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    control.dispatchEvent(spaceEvent);
    expect(onRobotMapClick).toHaveBeenCalledTimes(2);
    expect(spaceEvent.defaultPrevented).toBe(true);
    expect(onRobotMapClick).toHaveBeenLastCalledWith('g1');
  });

  it('ignores other keys', () => {
    const { onRobotMapClick, control } = openPopover();
    fireEvent.keyDown(control, { key: 'Tab' });
    fireEvent.keyDown(control, { key: 'Escape' });
    expect(onRobotMapClick).not.toHaveBeenCalled();
  });
});

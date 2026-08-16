/**
 * @file FleetMap.test.tsx
 * @description Every SVG `role="button"` on the fleet map is a real button for
 *              keyboard users: the robot marker and the popover's close, "View
 *              details" and "Open robot's map" controls all activate on Enter
 *              and Space.
 * @feature fleet
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
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

function renderMap(overrides: Partial<React.ComponentProps<typeof FleetMap>> = {}) {
  const onRobotMapClick = vi.fn();
  const onRobotClick = vi.fn();
  render(
    <FleetMap
      robots={[robot]}
      zones={[]}
      selectedFloor="1"
      onFloorChange={() => {}}
      onRobotClick={onRobotClick}
      onRobotMapClick={onRobotMapClick}
      {...overrides}
    />,
  );
  return {
    onRobotMapClick,
    onRobotClick,
    marker: screen.getByRole('button', { name: 'Atlas - online' }),
  };
}

function openPopover(onRobotMapClick = vi.fn()) {
  const rendered = renderMap({ onRobotMapClick });
  fireEvent.click(rendered.marker);
  return { ...rendered, onRobotMapClick, control: screen.getByTestId('fleet-open-robot-map') };
}

/**
 * Presses Space on an element. Returns true when the handler called
 * `preventDefault()` (i.e. the page was kept from scrolling) — `fireEvent`
 * returns false for a cancelled event.
 */
function pressSpace(el: Element): boolean {
  return !fireEvent.keyDown(el, { key: ' ' });
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

    expect(pressSpace(control)).toBe(true);
    expect(onRobotMapClick).toHaveBeenCalledTimes(2);
    expect(onRobotMapClick).toHaveBeenLastCalledWith('g1');
  });

  it('ignores other keys', () => {
    const { onRobotMapClick, control } = openPopover();
    fireEvent.keyDown(control, { key: 'Tab' });
    fireEvent.keyDown(control, { key: 'Escape' });
    expect(onRobotMapClick).not.toHaveBeenCalled();
  });
});

describe('FleetMap — robot marker keyboard activation', () => {
  it('opens the popover on Enter', () => {
    const { marker } = renderMap();
    expect(screen.queryByTestId('fleet-view-details')).not.toBeInTheDocument();

    fireEvent.keyDown(marker, { key: 'Enter' });
    expect(screen.getByTestId('fleet-view-details')).toBeInTheDocument();
  });

  it('opens the popover on Space and prevents page scroll', () => {
    const { marker } = renderMap();

    expect(pressSpace(marker)).toBe(true);
    expect(screen.getByTestId('fleet-view-details')).toBeInTheDocument();
  });

  it('ignores other keys', () => {
    const { marker } = renderMap();
    fireEvent.keyDown(marker, { key: 'Tab' });
    fireEvent.keyDown(marker, { key: 'Escape' });
    expect(screen.queryByTestId('fleet-view-details')).not.toBeInTheDocument();
  });
});

describe('FleetMap — popover close control', () => {
  it('is labelled for screen readers', () => {
    openPopover();
    expect(screen.getByTestId('fleet-close-popup')).toHaveAttribute('aria-label', 'Close robot popup');
  });

  it('closes the popover on click, Enter and Space', () => {
    for (const activate of [
      (el: Element) => fireEvent.click(el),
      (el: Element) => fireEvent.keyDown(el, { key: 'Enter' }),
      (el: Element) => pressSpace(el),
    ]) {
      const { marker } = renderMap();
      fireEvent.click(marker);
      activate(screen.getByTestId('fleet-close-popup'));
      expect(screen.queryByTestId('fleet-view-details')).not.toBeInTheDocument();
      cleanup();
    }
  });
});

describe('FleetMap — "View details" control', () => {
  it('is labelled for screen readers', () => {
    openPopover();
    expect(screen.getByTestId('fleet-view-details')).toHaveAttribute('aria-label', 'View Atlas details');
  });

  it('activates on Enter and on Space (Space is prevented from scrolling)', () => {
    const { onRobotClick } = openPopover();
    const control = screen.getByTestId('fleet-view-details');

    fireEvent.keyDown(control, { key: 'Enter' });
    expect(onRobotClick).toHaveBeenCalledWith('g1');

    expect(pressSpace(control)).toBe(true);
    expect(onRobotClick).toHaveBeenCalledTimes(2);
  });

  it('ignores other keys', () => {
    const { onRobotClick } = openPopover();
    fireEvent.keyDown(screen.getByTestId('fleet-view-details'), { key: 'Escape' });
    expect(onRobotClick).not.toHaveBeenCalled();
  });
});

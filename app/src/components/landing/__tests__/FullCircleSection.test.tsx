/**
 * @file FullCircleSection.test.tsx
 * @description Checks the infinity lifecycle and accessible stage selection.
 * @feature landing
 */

import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FullCircleSection, STAGES, stagePosition } from '../FullCircleSection';

afterEach(cleanup);

describe('The Embodied Loop', () => {
  it('follows both lobes in lifecycle order and closes the infinity path', () => {
    expect(STAGES.map((stage) => stage.key)).toEqual([
      'collect',
      'train',
      'deploy',
      'evaluate',
      'operate',
      'comply',
    ]);
    STAGES.forEach((stage, index) => {
      expect(stage.index).toBe(index + 1);
      const position = stagePosition(stage.index);
      expect(position.x).toBeGreaterThanOrEqual(10);
      expect(position.x).toBeLessThanOrEqual(90);
    });
    expect(stagePosition(1).x).toBeCloseTo(10);
    expect(stagePosition(1).y).toBeCloseTo(50);
    expect(stagePosition(2).y).toBeLessThan(50);
    expect(stagePosition(3).y).toBeGreaterThan(50);
    expect(stagePosition(4).x).toBeCloseTo(90);
    expect(stagePosition(5).y).toBeLessThan(50);
    expect(stagePosition(6).y).toBeGreaterThan(50);
    expect(stagePosition(7).x).toBeCloseTo(stagePosition(1).x);
    expect(stagePosition(7).y).toBeCloseTo(stagePosition(1).y);
  });

  it('selects a stage and exposes its evidence and readiness in the controlled panel', () => {
    render(<FullCircleSection />);
    const deploy = screen.getByRole('button', { name: 'Deploy — Gated' });
    fireEvent.click(deploy);
    expect(deploy.getAttribute('aria-pressed')).toBe('true');
    expect(
      screen.getByRole('button', { name: 'Collect — Live' }).getAttribute('aria-pressed'),
    ).toBe('false');
    const panel = document.getElementById(deploy.getAttribute('aria-controls')!);
    expect(panel?.textContent).toContain('Shipped like software.');
    expect(panel?.textContent).toContain('The bridge to a real G1 is deliberately locked.');
    expect(
      screen.getByRole('link', { name: 'Explore the deployment gates' }).getAttribute('href'),
    ).toBe('#safety');
  });

  it('lets the visitor pause and resume the decorative animation', () => {
    const { container } = render(<FullCircleSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Pause loop animation' }));
    expect(container.querySelector('[data-paused="true"]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Play loop animation' }));
    expect(container.querySelector('[data-paused="false"]')).not.toBeNull();
  });
});

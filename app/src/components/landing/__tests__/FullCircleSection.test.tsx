/**
 * @file FullCircleSection.test.tsx
 * @description Checks the infinity lifecycle and accessible stage selection.
 * @feature landing
 */

import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { FullCircleSection, STAGES, stagePosition } from '../FullCircleSection';

/**
 * `collect` is the default active stage and its panel link is a route into the
 * docs, so the component renders a router `Link` on first paint — every render
 * here needs a router around it.
 */
function renderLoop() {
  return render(
    <MemoryRouter>
      <FullCircleSection />
    </MemoryRouter>,
  );
}

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
    renderLoop();
    const deploy = screen.getByRole('button', { name: 'Deploy — Gated' });
    fireEvent.click(deploy);
    expect(deploy.getAttribute('aria-pressed')).toBe('true');
    expect(
      screen.getByRole('button', { name: 'Collect — Live' }).getAttribute('aria-pressed'),
    ).toBe('false');
    const panel = document.getElementById(deploy.getAttribute('aria-controls')!);
    expect(panel?.textContent).toContain('Shipped like software.');
    expect(panel?.textContent).toContain('the bridge to a real G1 stays locked behind two arming');
    expect(
      screen.getByRole('link', { name: 'See the deployment gates hold' }).getAttribute('href'),
    ).toBe('#proof');
  });

  it('sends a stage panel either into the docs or down to the proof section', () => {
    renderLoop();
    // collect is active on first paint: a route into the product doc.
    expect(screen.getByRole('link', { name: /data engine/ }).getAttribute('href')).toBe(
      '/docs/platform#the-data-engine',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Operate — Sim' }));
    expect(screen.getByRole('link', { name: 'Watch it stop' }).getAttribute('href')).toBe('#proof');
    fireEvent.click(screen.getByRole('button', { name: 'Comply — Live' }));
    expect(
      screen.getByRole('link', { name: /ownership and the record/ }).getAttribute('href'),
    ).toBe('/docs/platform#ownership-and-the-record');
  });

  it('keeps every stage panel inside the intro prose budget', () => {
    STAGES.forEach((stage) => {
      expect(stage.bullets.length).toBeLessThanOrEqual(2);
      stage.bullets.forEach((bullet) => {
        expect(bullet.split(/\s+/).length).toBeLessThanOrEqual(18);
      });
      expect(stage.summary.split(/\s+/).length).toBeLessThanOrEqual(20);
    });
  });

  it('lets the visitor pause and resume the decorative animation', () => {
    const { container } = renderLoop();
    fireEvent.click(screen.getByRole('button', { name: 'Pause loop animation' }));
    expect(container.querySelector('[data-paused="true"]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Play loop animation' }));
    expect(container.querySelector('[data-paused="false"]')).not.toBeNull();
  });
});

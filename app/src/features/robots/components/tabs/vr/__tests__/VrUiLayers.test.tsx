/**
 * @file VrUiLayers.test.tsx
 * @description TASK-418 (D1): every VR UI surface draws over the robot model —
 *              no depth test, no depth write, a render order above the model's
 *              0 — and a button draws over its own plate.
 * @feature robots
 */

import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('@react-three/fiber', () => ({ useFrame: () => {} }));
vi.mock('../VrTextPlate', () => ({
  useTextPlate: () => ({ texture: { isTexture: true }, draw: () => {} }),
}));

/**
 * jsdom has no WebGL, so the R3F intrinsics (`mesh`, `meshBasicMaterial`) are
 * rendered as plain elements whose `data-*` attributes print the props three.js
 * would receive — through the JSX runtime, which is what the compiled TSX calls.
 */
const INTRINSIC = new Set(['group', 'mesh', 'meshBasicMaterial', 'planeGeometry']);
function asProbe(type: unknown, props: Record<string, unknown>): [unknown, Record<string, unknown>] {
  if (typeof type !== 'string' || !INTRINSIC.has(type)) return [type, props];
  const out: Record<string, unknown> = { 'data-three': type };
  for (const [k, v] of Object.entries(props)) {
    if (k === 'children') out.children = v;
    else if (typeof v !== 'object' || v === null) out[`data-${k.toLowerCase()}`] = String(v);
  }
  return ['div', out];
}
for (const runtime of ['react/jsx-runtime', 'react/jsx-dev-runtime']) {
  vi.doMock(runtime, async () => {
    const real = await vi.importActual<Record<string, (...a: unknown[]) => unknown>>(runtime);
    const wrap = (fn: ((...a: unknown[]) => unknown) | undefined) => fn && ((type: unknown, props: Record<string, unknown>, ...rest: unknown[]) => {
      const [t, p] = asProbe(type, props);
      return fn(t, p, ...rest);
    });
    return { ...real, jsx: wrap(real.jsx), jsxs: wrap(real.jsxs), jsxDEV: wrap(real.jsxDEV) };
  });
}

const { VrPanel, VR_UI_MATERIAL, VR_UI_RENDER_ORDER } = await import('../VrPanel');
const { VrButton } = await import('../VrButton');

describe('VR UI layers (TASK-418, D1)', () => {
  it('orders the UI above the robot (0) and a button above its plate', () => {
    expect(VR_UI_RENDER_ORDER.panel).toBeGreaterThan(0);
    expect(VR_UI_RENDER_ORDER.button).toBeGreaterThan(VR_UI_RENDER_ORDER.panel);
    expect(VR_UI_RENDER_ORDER.ray).toBeGreaterThan(VR_UI_RENDER_ORDER.hud);
    expect(VR_UI_MATERIAL).toMatchObject({ depthTest: false, depthWrite: false, transparent: true });
  });

  it('draws a panel without a depth test, over the robot', () => {
    const { container } = render(
      <VrPanel width={0.5} height={0.3} pxWidth={512} pxHeight={300} compose={() => ({ lines: [] })} />,
    );
    const mesh = container.querySelector('[data-three="mesh"]')!;
    expect(mesh.getAttribute('data-renderorder')).toBe(String(VR_UI_RENDER_ORDER.panel));
    const material = container.querySelector('[data-three="meshBasicMaterial"]')!;
    expect(material.getAttribute('data-depthtest')).toBe('false');
    expect(material.getAttribute('data-depthwrite')).toBe('false');
  });

  it('draws a button without a depth test, above the plate', () => {
    const { container } = render(<VrButton id="session-stop" label="Stop" onClick={() => {}} />);
    const mesh = container.querySelector('[data-three="mesh"]')!;
    expect(mesh.getAttribute('data-renderorder')).toBe(String(VR_UI_RENDER_ORDER.button));
    const material = container.querySelector('[data-three="meshBasicMaterial"]')!;
    expect(material.getAttribute('data-depthtest')).toBe('false');
    expect(material.getAttribute('data-depthwrite')).toBe('false');
  });
});

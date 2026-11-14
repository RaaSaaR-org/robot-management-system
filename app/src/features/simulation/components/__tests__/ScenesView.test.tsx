/**
 * @file ScenesView.test.tsx
 * @description TASK-503: a scene card whose preview image cannot be loaded
 *              shows the scene icon instead of an empty box.
 * @feature simulation
 */

import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../api/simulationApi', () => ({
  simulationApi: { getPreviewUrl: (envId: string) => `/api/simulation/preview/${envId}` },
}));

import { ScenesView } from '../ScenesView';
import type { SimScene } from '../../types';

const SCENE: SimScene = {
  id: 'scene-1',
  name: 'G1 pick and place',
  description: null,
  source: 'builtin',
  builtinEnvId: 'g1_pickplace',
  twinId: null,
  embodimentTag: 'unitree_g1',
  backend: 'mujoco',
  mjcfKey: null,
  usdKey: null,
  status: 'ready',
  bounds: { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 },
  tenantId: null,
  createdAt: '2026-11-13T00:00:00.000Z',
  updatedAt: '2026-11-13T00:00:00.000Z',
};

function renderScenes(scenes: SimScene[]) {
  return render(
    <ScenesView
      scenes={scenes}
      loading={false}
      error={null}
      onRetry={() => undefined}
      onPick={() => undefined}
      query=""
      onClearQuery={() => undefined}
    />,
  );
}

const previewOf = (container: HTMLElement) => container.querySelector('img');
const iconOf = (container: HTMLElement) => container.querySelector('svg.lucide-boxes');

describe('a scene card preview', () => {
  it('shows the rendered preview of a built-in scene', () => {
    const { container } = renderScenes([SCENE]);

    expect(previewOf(container)).toHaveAttribute('src', '/api/simulation/preview/g1_pickplace');
    expect(iconOf(container)).toBeNull();
  });

  it('falls back to the scene icon when the preview fails to load', () => {
    const { container } = renderScenes([SCENE]);

    fireEvent.error(previewOf(container)!);

    expect(previewOf(container)).toBeNull();
    expect(iconOf(container)).not.toBeNull();
    expect(screen.getByText('G1 pick and place')).toBeInTheDocument();
  });

  it('keeps the other cards on their previews when one fails', () => {
    const { container } = renderScenes([SCENE, { ...SCENE, id: 'scene-2', builtinEnvId: 'so101_tabletop' }]);

    fireEvent.error(container.querySelectorAll('img')[0]);

    expect(container.querySelectorAll('img')).toHaveLength(1);
    expect(previewOf(container)).toHaveAttribute('src', '/api/simulation/preview/so101_tabletop');
  });

  it('shows the icon for a scene without a built-in preview', () => {
    const { container } = renderScenes([{ ...SCENE, source: 'twin', builtinEnvId: null }]);

    expect(previewOf(container)).toBeNull();
    expect(iconOf(container)).not.toBeNull();
  });
});

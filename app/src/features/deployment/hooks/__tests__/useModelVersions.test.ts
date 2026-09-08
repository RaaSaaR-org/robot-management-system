/**
 * @file useModelVersions.test.ts
 * @description Regression coverage for model registry subscriptions and status changes
 * @feature deployment
 */

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useDeploymentStore } from '../../store';
import type { ModelVersion } from '../../types';
import { useModelVersions } from '../useModelVersions';

function version(id: string, deploymentStatus: ModelVersion['deploymentStatus']): ModelVersion {
  return {
    id,
    skillId: '',
    trainingJobId: null,
    version: '1.0',
    artifactUri: 'hf://neodem/demo',
    trainingMetrics: {},
    validationMetrics: {},
    deploymentStatus,
    createdAt: '2026-09-08T00:00:00Z',
    updatedAt: '2026-09-08T00:00:00Z',
  };
}

describe('useModelVersions', () => {
  beforeEach(() => useDeploymentStore.getState().reset());

  it('renders an empty registry without repeatedly updating the React root', () => {
    const { result, rerender } = renderHook(() => useModelVersions());
    expect(result.current.versions).toEqual([]);
    const staging = result.current.stagingVersions;
    rerender();
    expect(result.current.stagingVersions).toBe(staging);
  });

  it('updates status groups when a model is promoted', () => {
    useDeploymentStore.setState({ modelVersions: [version('model-1', 'staging')] });
    const { result } = renderHook(() => useModelVersions());
    expect(result.current.stagingVersions.map((model) => model.id)).toEqual(['model-1']);
    expect(result.current.productionVersions).toEqual([]);

    act(() => useDeploymentStore.setState({ modelVersions: [version('model-1', 'production')] }));
    expect(result.current.stagingVersions).toEqual([]);
    expect(result.current.productionVersions.map((model) => model.id)).toEqual(['model-1']);
  });
});

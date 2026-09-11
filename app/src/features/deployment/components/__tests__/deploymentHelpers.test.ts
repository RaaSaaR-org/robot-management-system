/**
 * @file deploymentHelpers.test.ts
 * @description Unit tests for the pure deployment helpers
 * @feature deployment
 */

import { describe, expect, it } from 'vitest';
import {
  canCancel,
  canPromote,
  canRollBack,
  deployToneFor,
  formatStageDuration,
  inScope,
  modelName,
  parametersToSchema,
  reachedStages,
  schemaToParameters,
} from '../deploymentHelpers';
import type { Deployment } from '../../types';

const stages = [
  { percentage: 5, durationMinutes: 60 },
  { percentage: 50, durationMinutes: 90 },
  { percentage: 100, durationMinutes: 0 },
];

function dep(status: Deployment['status'], trafficPercentage = 0) {
  return { status, trafficPercentage, canaryConfig: { stages, successThreshold: 0.95 } };
}

describe('deploymentHelpers', () => {
  it('splits deployments into active and history', () => {
    expect(inScope(dep('canary'), 'active')).toBe(true);
    expect(inScope(dep('production'), 'active')).toBe(true);
    expect(inScope(dep('production'), 'history')).toBe(false);
    expect(inScope(dep('pending'), 'history')).toBe(false);
    expect(inScope(dep('rolled_back'), 'history')).toBe(true);
    expect(inScope(dep('failed'), 'all')).toBe(true);
  });

  it('gates the acts by status', () => {
    expect(canPromote(dep('canary'))).toBe(true);
    expect(canPromote(dep('pending'))).toBe(false);
    expect(canRollBack(dep('production'))).toBe(true);
    expect(canRollBack(dep('pending'))).toBe(false);
    expect(canCancel(dep('pending'))).toBe(true);
    expect(canCancel(dep('production'))).toBe(false);
  });

  it('maps statuses the kit does not know', () => {
    expect(deployToneFor('canary')).toBe('info');
    expect(deployToneFor('production')).toBe('success');
    expect(deployToneFor('pending')).toBeUndefined();
  });

  it('names a model by name, skill, then version', () => {
    expect(modelName({ name: 'GR00T', version: '1' })).toBe('GR00T');
    expect(modelName({ name: null, version: '2', skill: { name: 'Pick' } as never })).toBe('Pick');
    expect(modelName({ name: '', version: '3' })).toBe('Model v3');
  });

  it('formats stage durations', () => {
    expect(formatStageDuration(0)).toBe('Until promoted');
    expect(formatStageDuration(45)).toBe('45 min');
    expect(formatStageDuration(90)).toBe('1 h 30 min');
    expect(formatStageDuration(1440)).toBe('24 h');
  });

  it('counts reached canary stages', () => {
    expect(reachedStages(dep('pending', 0))).toBe(0);
    expect(reachedStages(dep('canary', 5))).toBe(1);
    expect(reachedStages(dep('canary', 50))).toBe(2);
    expect(reachedStages(dep('production', 100))).toBe(3);
  });

  it('round-trips parameters through JSON Schema', () => {
    const params = [
      { name: 'target', type: 'string' as const, required: true, description: 'Object' },
      { name: 'speed', type: 'number' as const, required: false },
    ];
    const schema = parametersToSchema(params);
    expect(schema).toEqual({
      type: 'object',
      properties: { target: { type: 'string', description: 'Object' }, speed: { type: 'number' } },
      required: ['target'],
    });
    expect(schemaToParameters(schema)).toEqual([
      { name: 'target', type: 'string', required: true, description: 'Object' },
      { name: 'speed', type: 'number', required: false, description: undefined },
    ]);
    expect(parametersToSchema([])).toEqual({});
    expect(schemaToParameters({})).toEqual([]);
  });
});

/**
 * @file datasetFormat.test.ts
 * @description A source license in its usual spelling (TASK-506).
 * @feature training
 */

import { describe, it, expect } from 'vitest';
import { formatLicense } from '../datasetFormat';

describe('formatLicense', () => {
  it('spells the Hub ids the way their licenses do', () => {
    expect(formatLicense('cc-by-4.0')).toBe('CC-BY-4.0');
    expect(formatLicense('apache-2.0')).toBe('Apache-2.0');
    expect(formatLicense('mit')).toBe('MIT');
    expect(formatLicense(' odc-by ')).toBe('ODC-BY');
  });

  it('leaves anything else as written', () => {
    expect(formatLicense('other')).toBe('other');
    expect(formatLicense('Custom research license')).toBe('Custom research license');
  });
});

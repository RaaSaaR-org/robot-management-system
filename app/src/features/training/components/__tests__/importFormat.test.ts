/**
 * @file importFormat.test.ts
 * @description Hub link parsing, short revisions and failure headlines (TASK-358)
 * @feature training
 */

import { describe, expect, it } from 'vitest';
import {
  describeImportFailure,
  formatLerobotVersion,
  formatRepoAtRevision,
  parseHubReference,
  shortRevision,
} from '../datasets/importFormat';

const SHA = '89d5752c021e580d26d90ceec7e8192ef01e7c30';

describe('parseHubReference', () => {
  it('reads the revision out of a /tree/ link', () => {
    expect(parseHubReference('https://huggingface.co/datasets/lerobot/xarm_lift_medium/tree/v2.1'))
      .toEqual({ repoId: 'lerobot/xarm_lift_medium', revision: 'v2.1' });
  });

  it('reads the revision out of a /blob/ link to a file', () => {
    expect(parseHubReference(`huggingface.co/datasets/lerobot/pusht/blob/${SHA}/meta/info.json`))
      .toEqual({ repoId: 'lerobot/pusht', revision: SHA });
  });

  it('decodes a revision with a slash in it', () => {
    expect(parseHubReference('https://huggingface.co/datasets/a/b/tree/refs%2Fpr%2F3')?.revision).toBe('refs/pr/3');
  });

  it('names no revision for a plain link or a bare repo id', () => {
    expect(parseHubReference('https://huggingface.co/datasets/lerobot/pusht')).toEqual({ repoId: 'lerobot/pusht', revision: null });
    expect(parseHubReference('https://huggingface.co/datasets/lerobot/pusht?x=1')).toEqual({ repoId: 'lerobot/pusht', revision: null });
    expect(parseHubReference('lerobot/pusht')).toEqual({ repoId: 'lerobot/pusht', revision: null });
  });

  it('refuses what is neither', () => {
    expect(parseHubReference('')).toBeNull();
    expect(parseHubReference('pusht')).toBeNull();
    expect(parseHubReference('a b/c')).toBeNull();
  });
});

describe('revision and version labels', () => {
  it('shortens a commit and leaves a branch alone', () => {
    expect(shortRevision(SHA)).toBe('89d5752c');
    expect(shortRevision('v2.1')).toBe('v2.1');
    expect(shortRevision(null)).toBeNull();
    expect(formatRepoAtRevision('lerobot/pusht', SHA)).toBe('lerobot/pusht@89d5752c');
    expect(formatRepoAtRevision('lerobot/pusht', null)).toBe('lerobot/pusht');
  });

  it('labels the LeRobot version', () => {
    expect(formatLerobotVersion('v3.0')).toBe('LeRobot v3.0');
    expect(formatLerobotVersion('2.1')).toBe('LeRobot v2.1');
    expect(formatLerobotVersion(undefined)).toBeNull();
  });
});

describe('describeImportFailure', () => {
  it('puts the cause of a storage failure first and keeps the file for the tooltip', () => {
    const message = 'File data/chunk-000/episode_000012.parquet: write to rustfs failed after 3 attempt(s): connect ECONNREFUSED 10.43.0.9:9000';
    const summary = describeImportFailure(message);
    expect(summary.headline).toBe('Storage unreachable (ECONNREFUSED)');
    expect(summary.file).toBe('data/chunk-000/episode_000012.parquet');
    expect(summary.detail).toBe(message);
  });

  it('tells a Hub failure from a storage failure', () => {
    expect(describeImportFailure('File meta/info.json: fetch to rustfs failed after 3 attempt(s): getaddrinfo ENOTFOUND huggingface.co').headline)
      .toBe('Hugging Face unreachable (ENOTFOUND)');
    expect(describeImportFailure('File videos/a.mp4: fetch to local failed after 1 attempt(s): HTTP 401 Unauthorized').headline)
      .toBe('Hugging Face refused access (HTTP 401)');
  });

  it('uses the phase when the message names no side', () => {
    expect(describeImportFailure('connect ECONNREFUSED 127.0.0.1:9000', 'storing').headline).toBe('Storage unreachable (ECONNREFUSED)');
    expect(describeImportFailure('connect ECONNREFUSED 127.0.0.1:9000').headline).toBe('Connection unreachable (ECONNREFUSED)');
  });

  it('passes any other message through as its own headline', () => {
    expect(describeImportFailure('The server restarted during the import, so it stopped; retry the import.').headline)
      .toBe('The server restarted during the import, so it stopped; retry the import.');
    expect(describeImportFailure(null).headline).toBe('Import failed');
  });
});

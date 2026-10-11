/**
 * @file bucket-provisioning.test.ts
 * @description Every bucket the server uses is provisioned by both Helm charts (TASK-351).
 *
 * The server never creates a bucket — the chart's post-install Job does, from
 * `rustfs.buckets`. A `BUCKETS` entry the chart does not list fails its
 * feature only at runtime, on the first write, in whichever cluster has it.
 * Two charts provision RustFS: `helm/neodem` in this repo and the production
 * fork in the separate `deployments` repo, which is checked out next to this
 * one on a developer machine and absent in CI — so that half skips there.
 * @feature storage
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, statSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'yaml';
import { BUCKETS } from '../model-storage.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

/**
 * The main checkout's directory. In a git worktree `.git` is a file naming
 * `<main>/.git/worktrees/<name>`, and the deployments repo sits next to the
 * main checkout, not next to the worktree.
 */
function mainCheckout(): string {
  const dotGit = join(REPO_ROOT, '.git');
  if (existsSync(dotGit) && statSync(dotGit).isFile()) {
    const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, 'utf8'));
    const i = m ? m[1].trim().lastIndexOf('/.git/worktrees/') : -1;
    if (m && i > 0) return m[1].trim().slice(0, i);
  }
  return REPO_ROOT;
}

const DEPLOYMENTS_VALUES = process.env.NEODEM_CHART
  ? join(process.env.NEODEM_CHART, 'values.yaml')
  : join(mainCheckout(), '..', 'deployments', 'neoDEM', 'values.yaml');

function chartBuckets(valuesPath: string): string[] {
  const values = parse(readFileSync(valuesPath, 'utf8')) as { rustfs?: { buckets?: unknown } };
  const buckets = values.rustfs?.buckets;
  return Array.isArray(buckets) ? buckets.map(String) : [];
}

function missingFrom(valuesPath: string): string[] {
  const provisioned = new Set(chartBuckets(valuesPath));
  return Object.values(BUCKETS).filter((b) => !provisioned.has(b));
}

describe('RustFS bucket provisioning', () => {
  it('helm/neodem provisions every bucket in BUCKETS', () => {
    expect(missingFrom(join(REPO_ROOT, 'helm', 'neodem', 'values.yaml'))).toEqual([]);
  });

  it.skipIf(!existsSync(DEPLOYMENTS_VALUES))(
    'the production chart (deployments/neoDEM) provisions every bucket in BUCKETS',
    () => {
      expect(missingFrom(DEPLOYMENTS_VALUES)).toEqual([]);
    },
  );
});

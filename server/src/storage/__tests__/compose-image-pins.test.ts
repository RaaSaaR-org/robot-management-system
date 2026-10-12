/**
 * @file compose-image-pins.test.ts
 * @description docker-compose.yml pins every image, to the same version the Helm chart runs (TASK-372).
 *
 * `latest` changed under running installs (TASK-364 pinned the chart). The
 * local compose stack runs the same RustFS and aws-cli images, so a `latest`
 * left there drifts from what the chart — and the k3d E2E — tested.
 * @feature storage
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'yaml';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

interface ComposeFile {
  services: Record<string, { image?: string }>;
}

const compose = parse(readFileSync(resolve(REPO_ROOT, 'docker-compose.yml'), 'utf8')) as ComposeFile;
const values = parse(readFileSync(resolve(REPO_ROOT, 'helm/neodem/values.yaml'), 'utf8')) as {
  rustfs: { image: { repository: string; tag: string }; init: { image: { repository: string; tag: string } } };
  nats: { image: { repository: string; tag: string } };
  postgres: { image: { repository: string; tag: string } };
};

const images = Object.entries(compose.services)
  .filter(([, s]) => typeof s.image === 'string')
  .map(([name, s]) => [name, s.image as string] as const);

describe('docker-compose.yml image pins', () => {
  it.each(images)('%s names an explicit tag that is not latest', (_name, image) => {
    const tag = image.includes(':') ? image.slice(image.lastIndexOf(':') + 1) : '';
    expect(tag, image).not.toBe('');
    expect(tag, image).not.toBe('latest');
  });

  it('runs the same third-party versions as the Helm chart', () => {
    const byRepo = new Map(images.map(([, image]) => [image.slice(0, image.lastIndexOf(':')), image]));
    for (const { repository, tag } of [
      values.rustfs.image,
      values.rustfs.init.image,
      values.nats.image,
      values.postgres.image,
    ]) {
      expect(byRepo.get(repository), repository).toBe(`${repository}:${tag}`);
    }
  });
});

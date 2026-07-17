/**
 * @file register-local-dataset.ts
 * @description Register a local-dir LeRobot v2.1 dataset in the dev DB (no API route
 *              exists for storagePath registration — see TASK-169 robot-day runbook).
 *              Same pattern as seed-synthetic-demo.ts / the TASK-181 dry-run register script.
 * @feature training
 *
 * Usage (from the server dir, DATABASE_URL must be ABSOLUTE):
 *   $env:DATABASE_URL='file:C:/Unitree/robot-management-system/server/prisma/dev.db'
 *   npx tsx src/scripts/register-local-dataset.ts --dir C:/Unitree/_data/<dataset_v2.1> --name "Robot Day Teleop 2026-07-XX" [--robot-type-id <id>] [--description "..."]
 *
 * The --dir must contain LeRobot v2.1 layout (meta/info.json, data/chunk-000/, videos/).
 * Run convert_v3_to_v2.py first — the Unitree converter outputs v3.0, which the
 * local-dir episode/video endpoints cannot serve.
 */
import { PrismaClient } from '@prisma/client';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const DEFAULT_G1_ROBOT_TYPE_ID = '415822af-a618-4aa2-90e4-922f58693ab1'; // Unitree G1 (same as G1_Dex3_Pick7_Merged)

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

const dir = arg('dir');
const name = arg('name');
const robotTypeId = arg('robot-type-id') ?? DEFAULT_G1_ROBOT_TYPE_ID;
const description = arg('description') ?? `Local-dir LeRobot dataset registered via register-local-dataset.ts`;

if (!dir || !name) {
  console.error('Usage: npx tsx src/scripts/register-local-dataset.ts --dir <abs path to v2.1 dataset> --name "<display name>" [--robot-type-id <id>] [--description "..."]');
  process.exit(1);
}

const prisma = new PrismaClient();

async function main() {
  const infoPath = join(dir!, 'meta/info.json');
  if (!existsSync(infoPath)) {
    throw new Error(`${infoPath} not found — is --dir a LeRobot v2.1 dataset root? (v3.0 must be converted first)`);
  }
  const info = JSON.parse(readFileSync(infoPath, 'utf8'));
  if (String(info.codebase_version ?? '').startsWith('v3')) {
    throw new Error(`Dataset is ${info.codebase_version} — run convert_v3_to_v2.py first; local-dir serving is v2.1-only.`);
  }

  const existing = await prisma.dataset.findFirst({ where: { name: name! } });
  if (existing) {
    console.log('already registered:', existing.id);
    return;
  }

  let stats: Record<string, unknown> = {};
  try {
    const raw = JSON.parse(readFileSync(join(dir!, 'meta/stats.json'), 'utf8'));
    stats = { observation: raw['observation.state'], action: raw['action'] };
  } catch { /* stats.json is optional */ }

  const rt = await prisma.robotType.findUnique({ where: { id: robotTypeId } });
  if (!rt) throw new Error(`robot type ${robotTypeId} not found — pass --robot-type-id`);
  console.log('robotType:', rt.name);

  const fps = info.fps ?? 30;
  const totalFrames = info.total_frames ?? 0;
  const totalEpisodes = info.total_episodes ?? 0;

  const ds = await prisma.dataset.create({
    data: {
      name: name!,
      description,
      robotTypeId: rt.id,
      storagePath: `${dir!.replace(/\\/g, '/')}/`.replace(/\/+$/, '/'),
      lerobotVersion: info.codebase_version ?? 'v2.1',
      fps,
      totalFrames,
      totalDuration: fps > 0 ? Number((totalFrames / fps).toFixed(3)) : 0,
      demonstrationCount: totalEpisodes,
      qualityScore: 50,
      infoJson: JSON.stringify(info),
      statsJson: JSON.stringify(stats),
      status: 'ready',
    },
  });
  console.log('registered dataset', ds.id, '->', ds.name);
  console.log(`verify: curl http://localhost:3001/api/datasets/${ds.id}/episodes`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

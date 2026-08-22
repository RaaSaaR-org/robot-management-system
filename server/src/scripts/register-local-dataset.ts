/**
 * @file register-local-dataset.ts
 * @description Register a local-dir LeRobot dataset in the dev DB (no API route
 *              exists for storagePath registration — see TASK-169 robot-day runbook).
 *              Same pattern as seed-synthetic-demo.ts / the TASK-181 dry-run register script.
 * @feature training
 *
 * Usage (from the server dir, DATABASE_URL must be ABSOLUTE):
 *   $env:DATABASE_URL="file:$env:UNITREE_ROOT/robot-management-system/server/prisma/dev.db"
 *   npx tsx src/scripts/register-local-dataset.ts --dir $env:UNITREE_ROOT/_data/<dataset_v2.1> --name "Robot Day Teleop 2026-07-XX" [--robot-type-id <id>] [--description "..."]
 *
 * --dir is a LeRobot dataset root — meta/info.json and data/. EITHER VERSION:
 * v3.0 is what this platform writes and is served through a converted v2.1 view
 * built on first read (`services/lerobot/LocalDatasetView.ts`). Until TASK-217
 * this script rejected v3.0 outright, because nothing downstream could read it
 * and registering one produced a dataset row whose viewer was permanently
 * empty. Nothing is converted here: registration records where the dataset IS.
 *
 * Pass --validate to open the files before registering. Without it the dataset
 * is registered `ready` unchecked, which is what this script has always done
 * and is why `validateStructure` never saw a locally registered dataset.
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
const validate = process.argv.includes('--validate');
const robotTypeId = arg('robot-type-id') ?? DEFAULT_G1_ROBOT_TYPE_ID;
const description = arg('description') ?? `Local-dir LeRobot dataset registered via register-local-dataset.ts`;

if (!dir || !name) {
  console.error('Usage: npx tsx src/scripts/register-local-dataset.ts --dir <abs path to a LeRobot v2.1 or v3.0 dataset> --name "<display name>" [--robot-type-id <id>] [--description "..."] [--validate]');
  process.exit(1);
}

const prisma = new PrismaClient();

async function main() {
  const infoPath = join(dir!, 'meta/info.json');
  if (!existsSync(infoPath)) {
    throw new Error(`${infoPath} not found — is --dir a LeRobot dataset root?`);
  }
  const info = JSON.parse(readFileSync(infoPath, 'utf8'));
  const version = String(info.codebase_version ?? '');
  if (!version.startsWith('v2') && !version.startsWith('v3')) {
    throw new Error(`Dataset declares codebase_version ${version || '(none)'} — only v2.x and v3.x are read here.`);
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

  // These three numbers come out of `info.json`, which is the manifest and not
  // the files. `--validate` opens the files and writes back what is actually
  // there; without it they are the manifest's claim, and the dataset is
  // registered `ready` having been checked by nobody.
  let validationRecord: string | null = null;
  let status = 'ready';
  let qualityScore = 50;
  if (validate) {
    const { LocalDatasetTree } = await import('../services/lerobot/DatasetTree.js');
    const { validateDatasetStructure } = await import('../services/lerobot/validateDataset.js');
    const report = await validateDatasetStructure(new LocalDatasetTree(dir!), {
      proprioceptionDim: rt.proprioceptionDim,
      actionDim: rt.actionDim,
    });
    validationRecord = JSON.stringify({ validatedAt: new Date().toISOString(), report });
    status = report.valid ? 'ready' : 'failed';
    qualityScore = report.valid ? 60 : 0;
    for (const finding of report.errors) console.error(`  error  ${finding.code}: ${finding.message}`);
    for (const finding of report.warnings) console.warn(`  warn   ${finding.code}: ${finding.message}`);
    console.log(`validation: ${report.valid ? 'OK' : 'FAILED'} (${report.files.length} files opened)`);
  }

  const ds = await prisma.dataset.create({
    data: {
      name: name!,
      description,
      robotTypeId: rt.id,
      storagePath: `${dir!.replace(/\\/g, '/')}/`.replace(/\/+$/, '/'),
      lerobotVersion: version || 'v2.1',
      fps,
      totalFrames,
      totalDuration: fps > 0 ? Number((totalFrames / fps).toFixed(3)) : 0,
      demonstrationCount: totalEpisodes,
      qualityScore,
      infoJson: JSON.stringify(info),
      statsJson: JSON.stringify(stats),
      status,
      validationJson: validationRecord,
    },
  });
  console.log('registered dataset', ds.id, '->', ds.name);
  console.log(`verify: curl http://localhost:3001/api/datasets/${ds.id}/episodes`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

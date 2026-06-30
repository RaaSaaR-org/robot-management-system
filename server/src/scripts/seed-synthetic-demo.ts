/**
 * Dev-only seed: register an already-converted Cosmos synthetic dataset (TASK-178)
 * so the Datasets UI can be exercised without burning GPU quota. Mirrors
 * CosmosSyntheticService.registerDataset.
 *
 * Usage: tsx src/scripts/seed-synthetic-demo.ts <path-to-lerobot_cosmos_bridge>
 *   where the dir is a `convert` output (cosmos3_synth.py convert).
 */
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import { join } from 'path';

const DIR = process.argv[2];
if (!DIR) {
  console.error('Usage: tsx src/scripts/seed-synthetic-demo.ts <lerobot_cosmos_bridge dir>');
  process.exit(1);
}

const prisma = new PrismaClient();

async function main() {
  const info = JSON.parse(readFileSync(join(DIR, 'meta/info.json'), 'utf8'));
  let stats: Record<string, unknown> = {};
  try {
    const raw = JSON.parse(readFileSync(join(DIR, 'meta/stats.json'), 'utf8'));
    stats = { observation: raw['observation.state'], action: raw['action'] };
  } catch { /* optional */ }

  let rt = await prisma.robotType.findUnique({ where: { name: 'widowx_bridge' } });
  if (!rt) {
    rt = await prisma.robotType.create({
      data: {
        name: 'widowx_bridge',
        manufacturer: 'Trossen Robotics',
        model: 'WidowX 250 (bridge)',
        actionDim: 7,
        proprioceptionDim: 7,
        cameras: JSON.stringify([{ name: 'image_0', resolution: { width: 640, height: 480 }, fov: 60 }]),
        capabilities: JSON.stringify(['manipulation', 'synthetic']),
        limits: JSON.stringify({ position: { min: [], max: [] }, velocity: [], torque: [] }),
      },
    });
    console.log('created robotType widowx_bridge', rt.id);
  }

  const fps = info.fps ?? 5;
  const totalFrames = info.total_frames ?? 0;
  const totalEpisodes = info.total_episodes ?? 0;
  const infoJson = {
    ...info,
    _synthetic: true,
    _generator: info._generator ?? 'NVIDIA Cosmos 3 (forward dynamics)',
  };

  const ds = await prisma.dataset.create({
    data: {
      name: `Cosmos Synthetic — widowx_bridge (${totalEpisodes} ep, demo)`,
      description:
        'Synthetic widowx_bridge episodes generated with NVIDIA Cosmos 3 forward dynamics (TASK-178 demo seed).',
      robotTypeId: rt.id,
      storagePath: DIR.endsWith('/') ? DIR : `${DIR}/`,
      lerobotVersion: info.codebase_version ?? 'v2.1',
      fps,
      totalFrames,
      totalDuration: fps > 0 ? Number((totalFrames / fps).toFixed(3)) : 0,
      demonstrationCount: totalEpisodes,
      qualityScore: 62,
      infoJson: JSON.stringify(infoJson),
      statsJson: JSON.stringify(stats),
      status: 'ready',
    },
  });
  console.log('seeded synthetic dataset', ds.id, '->', ds.name);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

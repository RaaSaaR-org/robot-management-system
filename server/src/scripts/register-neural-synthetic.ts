/**
 * @file register-neural-synthetic.ts
 * @description Register an externally generated DreamGen-style synthetic dataset
 *   (TASK-182: Cosmos-Predict2-2B LoRA dreams + GR00T-dreams IDM pseudo-labels)
 *   as a ready `_synthetic` dataset row pointing at its absolute on-disk path.
 *   Mirrors CosmosSyntheticService.registerDataset for out-of-band generation runs.
 * @feature training
 *
 * Usage: npx tsx src/scripts/register-neural-synthetic.ts <path-to-dataset-root>
 *   where the dir holds a LeRobot v3.0 layout (meta/info.json — which carries the
 *   embedded _provenance written by convert.py — plus per-episode viewer-compat files).
 */
import { PrismaClient } from '@prisma/client';
import { existsSync, readFileSync } from 'fs';
import { isAbsolute, join, resolve } from 'path';

const DIR = process.argv[2];
if (!DIR) {
  console.error('Usage: npx tsx src/scripts/register-neural-synthetic.ts <dataset dir>');
  process.exit(1);
}
const ROOT = resolve(DIR);
if (!isAbsolute(ROOT) || !existsSync(join(ROOT, 'meta', 'info.json'))) {
  console.error(`No meta/info.json under ${ROOT}`);
  process.exit(1);
}

const prisma = new PrismaClient();

async function main() {
  const info = JSON.parse(readFileSync(join(ROOT, 'meta/info.json'), 'utf8'));
  // Inline validation — same rules as CosmosSyntheticService.registerDataset /
  // DatasetService.validateStructure: codebase_version, robot_type, fps > 0,
  // non-empty features, total_frames > 0.
  const problems: string[] = [];
  if (typeof info.codebase_version !== 'string') problems.push('codebase_version missing');
  if (typeof info.robot_type !== 'string') problems.push('robot_type missing');
  if (typeof info.fps !== 'number' || info.fps <= 0) problems.push('fps invalid');
  if (!info.features || Object.keys(info.features).length === 0) problems.push('features empty');
  if (!(info.total_frames > 0)) problems.push('total_frames missing');
  if (problems.length > 0) {
    console.error('Dataset validation FAILED:', problems.join('; '));
    process.exit(1);
  }
  console.log(
    `validation OK: ${info.codebase_version} ${info.robot_type} — ` +
      `${info.total_episodes} episodes, ${info.total_frames} frames @ ${info.fps} fps`,
  );

  let stats: Record<string, unknown> = {};
  try {
    const raw = JSON.parse(readFileSync(join(ROOT, 'meta/stats.json'), 'utf8'));
    stats = { observation: raw['observation.state'], action: raw['action'] };
  } catch {
    /* optional */
  }
  // convert.py embeds provenance in info.json (info._provenance); a sidecar
  // meta/provenance.json is only present for out-of-band dreams runs.
  let provenance: Record<string, unknown> | null = info._provenance ?? null;
  try {
    provenance = JSON.parse(readFileSync(join(ROOT, 'meta/provenance.json'), 'utf8'));
  } catch {
    /* optional sidecar — info._provenance already applied above */
  }

  // Canonical G1 RobotType name (matches CosmosSyntheticService / seed-robot-types),
  // so synthetic datasets group with real teleop recordings rather than a divergent row.
  const typeName = 'Unitree G1 + Dex3';
  let rt = await prisma.robotType.findUnique({ where: { name: typeName } });
  if (!rt) {
    rt = await prisma.robotType.create({
      data: {
        name: typeName,
        manufacturer: 'Unitree',
        model: 'G1 EDU (29 DoF) + Dex3-1',
        actionDim: 28,
        proprioceptionDim: 28,
        cameras: JSON.stringify([
          { name: 'cam_right_high', resolution: { width: 256, height: 256 }, fov: 60 },
        ]),
        capabilities: JSON.stringify(['manipulation', 'humanoid', 'synthetic']),
        limits: JSON.stringify({ position: { min: [], max: [] }, velocity: [], torque: [] }),
      },
    });
    console.log(`created robotType ${typeName}`, rt.id);
  }

  const fps = info.fps;
  const totalFrames = info.total_frames ?? 0;
  const totalEpisodes = info.total_episodes ?? 0;
  const infoJson = {
    ...info,
    _synthetic: true,
    _generator: 'neural-trajectory (GR00T-dreams / Cosmos-Predict2-2B LoRA + IDM, TASK-182)',
    _provenance: provenance ?? undefined,
  };

  const ds = await prisma.dataset.create({
    data: {
      name: `g1_dex3_pickbottle_synthetic (${totalEpisodes} ep)`,
      description:
        'DreamGen-style neural trajectories for the Unitree G1 + Dex3: Cosmos-Predict2-2B ' +
        '(LoRA post-trained on real teleop) video dreams, actions pseudo-labeled by the ' +
        'GR00T-dreams IDM (holdout MAE 0.079 rad / 5.5% norm). Synthetic — not robot-recorded. TASK-182.',
      robotTypeId: rt.id,
      storagePath: ROOT.endsWith('/') || ROOT.endsWith('\\') ? ROOT : `${ROOT}/`,
      lerobotVersion: info.codebase_version ?? 'v3.0',
      fps,
      totalFrames,
      totalDuration: fps > 0 ? Number((totalFrames / fps).toFixed(3)) : 0,
      demonstrationCount: totalEpisodes,
      qualityScore: 70,
      infoJson: JSON.stringify(infoJson),
      statsJson: JSON.stringify(stats),
      status: 'ready',
    },
  });
  console.log('registered synthetic dataset', ds.id, '->', ds.name);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

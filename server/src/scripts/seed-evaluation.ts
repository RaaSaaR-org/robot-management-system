/**
 * @file seed-evaluation.ts
 * @description Seed evaluation episodes for development/testing
 * @feature evaluation
 *
 * Run: npx tsx server/src/scripts/seed-evaluation.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const ROBOT_ID = 'so101-igor-001';
const MODEL_VERSIONS = ['smolvla-v0.3.1', 'smolvla-v0.4.0', 'smolvla-v0.4.1'];

const TASK_PROMPTS = [
  'Pick up the red cube and place it in the bin',
  'Move the gripper to the home position',
  'Grasp the bottle and hand it over',
  'Stack the blue block on top of the green block',
  'Push the object to the left edge of the table',
  'Pick up the screwdriver from the tray',
  'Place the cup on the coaster',
  'Sort the colored blocks into matching bins',
];

const ERROR_TYPES = [
  'grasp_failure',
  'collision_detected',
  'timeout',
  'pose_estimation_error',
  'joint_limit_exceeded',
  null, // no error (success)
];

function randomDate(daysAgo: number): Date {
  const now = Date.now();
  const start = now - daysAgo * 24 * 60 * 60 * 1000;
  return new Date(start + Math.random() * (now - start));
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function main() {
  // Ensure the robot exists
  const robot = await prisma.robot.findUnique({ where: { id: ROBOT_ID } });
  if (!robot) {
    console.log(`Robot ${ROBOT_ID} not found, creating it...`);
    await prisma.robot.create({
      data: {
        id: ROBOT_ID,
        name: 'SO-101 Igor',
        model: 'SO-101',
        status: 'idle',
        batteryLevel: null,
      },
    });
  }

  // Clear existing evaluation episodes
  const deleted = await prisma.evaluationEpisode.deleteMany({
    where: { robotId: ROBOT_ID },
  });
  console.log(`Cleared ${deleted.count} existing evaluation episodes`);

  // Create 25 seed episodes spread over the last 14 days
  const episodes = [];
  for (let i = 0; i < 25; i++) {
    const modelVersion = pick(MODEL_VERSIONS);
    const taskPrompt = pick(TASK_PROMPTS);

    // Newer model versions have higher success rates
    let successChance = 0.5;
    if (modelVersion === 'smolvla-v0.4.0') successChance = 0.7;
    if (modelVersion === 'smolvla-v0.4.1') successChance = 0.85;

    const success = Math.random() < successChance;
    const errorType = success ? null : pick(ERROR_TYPES.filter(Boolean));
    const durationMs = randomInt(2000, 15000);
    const startedAt = randomDate(14);
    const endedAt = new Date(startedAt.getTime() + durationMs);

    episodes.push({
      robotId: ROBOT_ID,
      modelVersion,
      taskPrompt,
      startedAt,
      endedAt,
      durationMs,
      success,
      errorType,
      videoUrl: null,
      metadata: JSON.stringify({ seed: true, index: i }),
    });
  }

  for (const ep of episodes) {
    await prisma.evaluationEpisode.create({ data: ep });
  }

  console.log(`Seeded ${episodes.length} evaluation episodes for ${ROBOT_ID}`);

  // Print summary
  const total = episodes.length;
  const successful = episodes.filter((e) => e.success).length;
  console.log(`  Success: ${successful}/${total} (${((successful / total) * 100).toFixed(1)}%)`);
  for (const mv of MODEL_VERSIONS) {
    const mvEps = episodes.filter((e) => e.modelVersion === mv);
    const mvSuccess = mvEps.filter((e) => e.success).length;
    console.log(`  ${mv}: ${mvSuccess}/${mvEps.length}`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});

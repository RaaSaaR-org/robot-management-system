import { PrismaClient } from '@prisma/client';
import { v4 as uuid } from 'uuid';

async function main() {
  const p = new PrismaClient();
  const types = [
    {
      id: uuid(), name: 'SO-101 Follower',
      manufacturer: 'TheRobotStudio', model: 'SO-ARM100',
      actionDim: 6, proprioceptionDim: 6,
    },
    {
      id: uuid(), name: 'Unitree G1 + Dex3',
      manufacturer: 'Unitree Robotics', model: 'G1 EDU (Dex3-1)',
      // 43 DOF: 29 G1 body + 14 Dex3-1 (7 per hand); proprioception = pos + vel.
      // Matches robot-agent embodiment tag `unitree_g1_edu_dex3`.
      actionDim: 43, proprioceptionDim: 86,
    },
    {
      id: uuid(), name: 'ALOHA',
      manufacturer: 'UW/Toyota', model: 'ALOHA',
      actionDim: 0, proprioceptionDim: 0,
    },
    {
      id: uuid(), name: 'PushT Sim',
      manufacturer: 'Simulation', model: 'PushT',
      actionDim: 2, proprioceptionDim: 2,
    },
  ];
  for (const t of types) {
    const r = await p.robotType.upsert({
      where: { name: t.name },
      // Keep dims/model in sync on re-seed so existing DBs pick up corrections.
      update: {
        manufacturer: t.manufacturer,
        model: t.model,
        actionDim: t.actionDim,
        proprioceptionDim: t.proprioceptionDim,
      },
      create: t,
    });
    console.log('OK:', r.id, r.name);
  }
  await p.$disconnect();
}

main().catch(e => { console.error(e.message); process.exit(1); });

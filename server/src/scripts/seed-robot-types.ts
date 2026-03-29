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
      manufacturer: 'Unitree Robotics', model: 'G1',
      actionDim: 0, proprioceptionDim: 0,
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
      update: {},
      create: t,
    });
    console.log('OK:', r.id, r.name);
  }
  await p.$disconnect();
}

main().catch(e => { console.error(e.message); process.exit(1); });

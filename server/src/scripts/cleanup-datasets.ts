import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const deleted = await p.dataset.deleteMany({
    where: { status: { in: ['importing', 'failed'] } },
  });
  console.log('Deleted datasets:', deleted.count);
  await p.$disconnect();
}
main().catch(e => { console.error(e.message); process.exit(1); });

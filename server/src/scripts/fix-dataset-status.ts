import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  // Show current state
  const datasets = await p.dataset.findMany();
  console.log('Current datasets:');
  for (const d of datasets) {
    console.log(`  ${d.id} [${d.status}] ${d.name} score=${d.qualityScore}`);
  }

  // Mark importing ones as ready (they were validated successfully per logs)
  const result = await p.dataset.updateMany({
    where: { status: 'importing' },
    data: { status: 'ready', qualityScore: 70 },
  });
  console.log(`\nUpdated ${result.count} datasets to 'ready'`);
  await p.$disconnect();
}
main().catch(e => { console.error(e.message); process.exit(1); });

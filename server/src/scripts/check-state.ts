import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const ds = await p.dataset.findMany();
  console.log('Total datasets:', ds.length);
  for (const d of ds) console.log(`  ${d.id} [${d.status}] ${d.name} path=${d.storagePath}`);
  const rts = await p.robotType.findMany();
  console.log('Robot types:', rts.length);
  for (const r of rts) console.log(`  ${r.id} ${r.name}`);
  await p.$disconnect();
}
main().catch(e => { console.error(e.message); process.exit(1); });

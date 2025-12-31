
import { prisma } from './lib/prisma';

async function main() {
  try {
    const allCounts = await prisma.knowledge_sources.groupBy({
      by: ['sheet_name'],
      _count: true,
    });

    console.log('Counts by sheet_name:', allCounts);

    const top10 = await prisma.knowledge_sources.findMany({
      orderBy: { created_at: 'desc' },
      take: 10,
      select: { id: true, sheet_name: true, created_at: true }
    });
    console.log('Top 10 latest items:', top10);
  } catch (e) {
    console.error(e);
  }
}

main();

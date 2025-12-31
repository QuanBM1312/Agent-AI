
import { prisma } from './lib/prisma';
import { Prisma } from '@prisma/client';

async function verify() {
  console.log('--- Verifying SOURCE filtering ---');
  // type=source: sheet_name IN ('WEB_URL', 'GOOGLE_SHEET')
  const sources = await prisma.knowledge_sources.findMany({
    where: {
      sheet_name: { in: ['WEB_URL', 'GOOGLE_SHEET'] }
    },
    take: 5,
    select: { id: true, sheet_name: true }
  });
  console.log(`Found ${sources.length} sources.`);
  sources.forEach(s => {
    if (['WEB_URL', 'GOOGLE_SHEET'].includes(s.sheet_name || '')) {
      console.log(`PASS: Source ${s.id} has sheet_name ${s.sheet_name}`);
    } else {
      console.error(`FAIL: Source ${s.id} has unexpected sheet_name ${s.sheet_name}`);
    }
  });

  console.log('\n--- Verifying DOCUMENT filtering ---');
  // type=document: sheet_name NOT IN ('WEB_URL', 'GOOGLE_SHEET') OR sheet_name IS NULL
  // Prisma equivalent for raw SQL logic:
  const documents = await prisma.knowledge_sources.findMany({
    where: {
      OR: [
        { sheet_name: { notIn: ['WEB_URL', 'GOOGLE_SHEET'] } },
        { sheet_name: null }
      ]
    },
    take: 5,
    select: { id: true, sheet_name: true }
  });
  console.log(`Found ${documents.length} documents.`);
  documents.forEach(d => {
    if (!['WEB_URL', 'GOOGLE_SHEET'].includes(d.sheet_name || '')) {
      console.log(`PASS: Document ${d.id} has sheet_name ${d.sheet_name}`);
    } else {
      console.error(`FAIL: Document ${d.id} has unexpected sheet_name ${d.sheet_name}`);
    }
  });
}

verify();

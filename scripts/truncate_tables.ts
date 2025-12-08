import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  // List of tables to truncate in order of dependency (child first, then parent)
  // although CASCADE handles it, it's good to be explicit or just use CASCADE on the main ones.
  const tablenames = [
    'job_line_items',
    'chat_messages',
    'calendar_events',
    'job_reports',
    'chat_sessions',
    'jobs',
    'users'
  ]

  console.log('Starting truncation of affected tables...')

  for (const tableName of tablenames) {
    try {
      // Use CASCADE to ensure dependent rows are also removed if not covered by the list
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "public"."${tableName}" CASCADE;`)
      console.log(`✅ Truncated table: "${tableName}"`)
    } catch (error) {
      console.warn(`⚠️ Could not truncate "${tableName}". It might not exist or is already empty. Error: ${error}`)
    }
  }

  console.log('Truncation complete.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

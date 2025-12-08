import { PrismaClient } from '@prisma/client'
import { createClerkClient } from '@clerk/backend'

const prisma = new PrismaClient()
const clerkClient = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY })

async function main() {
  console.log('Fetching users from Clerk...')
  const clerkUsers = await clerkClient.users.getUserList()

  if (clerkUsers.data.length === 0) {
    console.log('No users found in Clerk.')
    return
  }

  console.log(`Found ${clerkUsers.data.length} users in Clerk. Syncing to DB...`)

  for (const user of clerkUsers.data) {
    const email = user.emailAddresses[0]?.emailAddress
    const fullName = `${user.firstName || ''} ${user.lastName || ''}`.trim()

    if (!email) {
      console.warn(`Skipping user ${user.id} (no email)`)
      continue
    }

    try {
      const upsertedUser = await prisma.users.upsert({
        where: { id: user.id },
        update: {
          email: email,
          full_name: fullName,
        },
        create: {
          id: user.id,
          email: email,
          full_name: fullName,
          role: 'Technician', // Default role
        },
      })
      console.log(`✅ Synced user: ${upsertedUser.email} (${upsertedUser.id})`)
    } catch (error) {
      console.error(`❌ Failed to sync user ${email}:`, error)
    }
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

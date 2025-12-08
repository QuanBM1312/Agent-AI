import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const email = 'qbuiminh5@gmail.com'
  console.log(`Updating role for user: ${email}...`)

  try {
    const user = await prisma.users.update({
      where: { email: email },
      data: { role: 'Admin' },
    })
    console.log(`✅ Success! User ${user.email} is now an ${user.role}.`)
  } catch (error) {
    console.error(`❌ Failed to update user:`, error)
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

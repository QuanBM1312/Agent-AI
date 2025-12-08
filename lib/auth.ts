import { auth } from '@clerk/nextjs/server'
import { prisma } from '@/lib/prisma'
import { user_role_enum } from '@prisma/client'

export async function checkRole(allowedRoles: user_role_enum[]) {
  const { userId } = await auth()

  if (!userId) {
    return false
  }

  const user = await prisma.users.findUnique({
    where: { id: userId },
    select: { role: true },
  })

  if (!user || !user.role) {
    return false
  }

  return allowedRoles.includes(user.role)
}

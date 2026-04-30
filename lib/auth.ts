import { user_role_enum } from '@prisma/client'
import { getCurrentUserWithRole } from '@/lib/auth-utils'

export async function checkRole(allowedRoles: user_role_enum[]) {
  const user = await getCurrentUserWithRole()

  if (!user || !user.role) {
    return false
  }

  return allowedRoles.includes(user.role)
}

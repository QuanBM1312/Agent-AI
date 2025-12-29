import { getCurrentUserWithRole } from "@/lib/auth-utils"
import { UsersPanel } from "@/components/users-panel"

export default async function UsersPage() {
  const user = await getCurrentUserWithRole()
  return <UsersPanel userRole={user?.role || "NOT_ASSIGN"} />
}

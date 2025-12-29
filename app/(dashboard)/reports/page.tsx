import { getCurrentUserWithRole } from "@/lib/auth-utils"
import { ReportsPanel } from "@/components/reports-panel"

export default async function ReportsPage() {
  const user = await getCurrentUserWithRole()
  return <ReportsPanel userRole={user?.role || "NOT_ASSIGN"} />
}

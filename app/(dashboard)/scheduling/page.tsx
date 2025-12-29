import { getCurrentUserWithRole } from "@/lib/auth-utils"
import { SchedulingPanel } from "@/components/scheduling-panel"

export default async function SchedulingPage() {
  const user = await getCurrentUserWithRole()
  return <SchedulingPanel userRole={user?.role || "NOT_ASSIGN"} />
}

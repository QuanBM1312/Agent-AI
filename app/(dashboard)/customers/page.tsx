import { getCurrentUserWithRole } from "@/lib/auth-utils"
import { CustomersPanel } from "@/components/customers-panel"

export default async function CustomersPage() {
  const user = await getCurrentUserWithRole()
  return <CustomersPanel userRole={user?.role || "NOT_ASSIGN"} />
}

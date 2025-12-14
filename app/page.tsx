
import { MobileMenuProvider } from "@/components/mobile-menu-context"
import { HomeContent } from "@/components/home-content"
import { getCurrentUserWithRole } from "@/lib/auth-utils"

export default async function Home() {
  const user = await getCurrentUserWithRole()
  // Default to Technician if role is missing/undefined (safety fallback)
  const userRole = user?.role || "Technician"

  return (
    <MobileMenuProvider>
      <HomeContent userRole={userRole} />
    </MobileMenuProvider>
  )
}

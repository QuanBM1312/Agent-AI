
import { MobileMenuProvider } from "@/components/mobile-menu-context"
import { HomeContent } from "@/components/home-content"
import { getCurrentUserWithRole } from "@/lib/auth-utils"

export default async function Home() {
  const user = await getCurrentUserWithRole()

  return (
    <MobileMenuProvider>
      <HomeContent user={user} />
    </MobileMenuProvider>
  )
}

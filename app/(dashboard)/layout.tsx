import { getCurrentUserWithRole } from "@/lib/auth-utils"
import { SidebarWrapper } from "@/components/sidebar-wrapper"
import { ChatSessionProvider } from "@/components/contexts/chat-session-context"
import { MobileMenuProvider } from "@/components/mobile-menu-context"
import { redirect } from "next/navigation"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await getCurrentUserWithRole()

  if (!user || (user.role as string) === "NOT_ASSIGN") {
    // If not assigned, HomeContent handles the "Not Authorized" view
    // But since we are moving to routing, maybe we should redirect or handle it here.
    // Let's allow access to the layout but handle the unauthorized view in a specific way if needed.
    // For now, let's just make sure we have a user.
    if (!user) redirect("/")
  }

  return (
    <MobileMenuProvider>
      <ChatSessionProvider>
        <div className="flex h-screen bg-background">
          <SidebarWrapper userRole={user.role} />
          <main className="flex-1 overflow-hidden relative">
            {children}
          </main>
        </div>
      </ChatSessionProvider>
    </MobileMenuProvider>
  )
}

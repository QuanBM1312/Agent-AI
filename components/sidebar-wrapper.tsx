"use client"

import { Sidebar } from "@/components/sidebar"
import { usePathname, useRouter, useParams } from "next/navigation"
import { useChatSessions } from "@/components/contexts/chat-session-context"
import { v4 as uuidv4 } from "uuid"

export function SidebarWrapper({ userRole }: { userRole: string }) {
  const pathname = usePathname()
  const router = useRouter()
  const params = useParams()
  const { sessions, isLoading, refreshSessions } = useChatSessions()

  // Derive activeTab from pathname
  // e.g., "/knowledge" -> "knowledge"
  // "/chat/123" -> "chat"
  const activeTab = pathname.split("/")[1] || "chat"
  const activeSessionId = params.sessionId as string || ""

  const handleSessionSelect = (id: string) => {
    router.push(`/chat/${id}`)
  }

  const handleNewChat = () => {
    const newId = uuidv4()
    router.push(`/chat/${newId}`)
  }

  const handleTabChange = (tabId: string) => {
    if (tabId === "chat") {
      // Just toggle expand in sidebar, handled internally by Sidebar usually
      // But we can also suggest a default behavior if needed
    } else {
      router.push(`/${tabId}`)
    }
  }

  return (
    <Sidebar
      activeTab={activeTab}
      setActiveTab={handleTabChange}
      sessions={sessions}
      isLoading={isLoading}
      activeSessionId={activeSessionId}
      onSessionSelect={handleSessionSelect}
      onNewChat={handleNewChat}
      userRole={userRole}
    />
  )
}

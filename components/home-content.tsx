"use client"

import { useState, useEffect, useCallback } from "react"
import { Sidebar } from "@/components/sidebar"
import { ChatInterface } from "@/components/chat-interface"
import { KnowledgePortal } from "@/components/knowledge-portal"
import { SchedulingPanel } from "@/components/scheduling-panel"
import { StoragePanel } from "@/components/storage-panel"
import { ReportsPanel } from "@/components/reports-panel"
import { useMobileMenu } from "@/components/mobile-menu-context"
import { useUser } from "@clerk/nextjs"
import { v4 as uuidv4 } from 'uuid'
import { ChatSession } from "@/lib/types"

export function HomeContent({ userRole }: { userRole: string }) {
  const [activeTab, setActiveTab] = useState("chat")
  const { setIsOpen } = useMobileMenu()
  const { user } = useUser()
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [isLoading, setIsLoading] = useState(false)

  const [activeSessionId, setActiveSessionId] = useState<string>(() => uuidv4())

  useEffect(() => {
    const handleToggle = () => setIsOpen(true)
    window.addEventListener('toggleMobileMenu', handleToggle)
    return () => window.removeEventListener('toggleMobileMenu', handleToggle)
  }, [setIsOpen])

  const fetchSessions = useCallback(async () => {
    if (!user?.id) return
    setIsLoading(true)
    try {
      const res = await fetch(`/api/chat/sessions`)
      if (res.ok) {
        const data = await res.json()
        setSessions(data)
      }
    } catch (e) {
      console.error("Failed to fetch sessions", e)
    } finally {
      setIsLoading(false)
    }
  }, [user?.id])

  useEffect(() => {
    fetchSessions()
  }, [fetchSessions])

  const handleNewSession = () => {
    const newSessionId = uuidv4()
    setActiveSessionId(newSessionId)
    if (activeTab !== "chat") setActiveTab("chat")
  }

  const handleSessionSelect = (sessionId: string) => {
    setActiveSessionId(sessionId)
    if (activeTab !== "chat") setActiveTab("chat")
  }

  return (
    <div className="flex h-screen bg-background">
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        sessions={sessions}
        isLoading={isLoading}
        activeSessionId={activeSessionId}
        onSessionSelect={handleSessionSelect}
        onNewChat={handleNewSession}
        userRole={userRole}
      />

      <main className="flex-1 overflow-hidden">
        {activeTab === "chat" && (
          <ChatInterface
            activeSessionId={activeSessionId}
            onMessageSent={fetchSessions}
          />
        )}
        {activeTab === "knowledge" && <KnowledgePortal />}
        {activeTab === "scheduling" && <SchedulingPanel />}
        {activeTab === "reports" && <ReportsPanel userRole={userRole} />}
        {activeTab === "storage" && <StoragePanel />}
      </main>
    </div>
  )
}

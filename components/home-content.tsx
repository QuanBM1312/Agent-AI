"use client"

import { useState, useEffect, useCallback } from "react"
import { Sidebar } from "@/components/sidebar"
import { ChatInterface } from "@/components/chat-interface"
import { KnowledgePortal } from "@/components/knowledge-portal"
import { SchedulingPanel } from "@/components/scheduling-panel"
import { StoragePanel } from "@/components/storage-panel"
import { ReportsPanel } from "@/components/reports-panel"
import { CustomersPanel } from "@/components/customers-panel"
import { UsersPanel } from "@/components/users-panel"
import { useMobileMenu } from "@/components/mobile-menu-context"
import { useUser } from "@clerk/nextjs"
import { v4 as uuidv4 } from 'uuid'
import { ChatSession } from "@/lib/types"
import { Users, LogIn } from "lucide-react"
import { SignInButton } from "@clerk/nextjs"

export function HomeContent({ user: serverUser }: { user: Awaited<ReturnType<typeof import("@/lib/auth-utils").getCurrentUserWithRole>> }) {
  const [activeTab, setActiveTab] = useState("chat")
  const { setIsOpen } = useMobileMenu()
  const { user, isLoaded } = useUser()
  const userRole = serverUser?.role || "NOT_ASSIGN"
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
        setSessions(data.data || [])
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
        {!isLoaded || !user || !serverUser ? (
          <div className="h-full flex flex-col items-center justify-center p-8 text-center bg-gray-50/50">
            <div className="bg-white p-8 rounded-xl shadow-sm border max-w-md w-full">
              <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <LogIn className="w-8 h-8" />
              </div>
              <h2 className="text-2xl font-semibold text-gray-900 mb-2">Vui lòng đăng nhập</h2>
              <p className="text-gray-500 mb-6">
                Bạn cần đăng nhập để truy cập vào hệ thống Sutra AI Operating System.
              </p>
              <SignInButton mode="modal">
                <button className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-6 rounded-lg transition-colors">
                  Đăng nhập
                </button>
              </SignInButton>
            </div>
          </div>
        ) : userRole === "NOT_ASSIGN" ? (
          <div className="h-full flex flex-col items-center justify-center p-8 text-center bg-gray-50/50">
            <div className="bg-white p-8 rounded-xl shadow-sm border max-w-md w-full">
              <div className="w-16 h-16 bg-yellow-100 text-yellow-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <Users className="w-8 h-8" />
              </div>
              <h2 className="text-2xl font-semibold text-gray-900 mb-2">Tài khoản chưa được cấp quyền</h2>
              <p className="text-gray-500 mb-6">
                Xin chào, tài khoản của bạn hiện chưa được phân quyền. Vui lòng liên hệ với quản trị viên để được kích hoạt và truy cập vào hệ thống.
              </p>
              <div className="text-sm text-gray-400">
                Email: {user?.primaryEmailAddress?.emailAddress}
              </div>
            </div>
          </div>
        ) : (
          <>
            {activeTab === "chat" && (
              <ChatInterface
                activeSessionId={activeSessionId}
                onMessageSent={fetchSessions}
              />
            )}
            {activeTab === "knowledge" && <KnowledgePortal />}
            {activeTab === "scheduling" && <SchedulingPanel userRole={userRole} />}
            {activeTab === "reports" && <ReportsPanel userRole={userRole} />}
            {activeTab === "storage" && <StoragePanel />}
            {activeTab === "customers" && <CustomersPanel userRole={userRole} />}
            {activeTab === "users" && <UsersPanel userRole={userRole} />}
          </>
        )}
      </main>
    </div>
  )
}

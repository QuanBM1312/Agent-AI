"use client"

import { MessageSquare, BookOpen, Calendar, Archive, LogOut, X, ChevronDown, ChevronRight, Plus, Loader2, FileText, Users, UserCog } from "lucide-react"
import { useMobileMenu } from "./mobile-menu-context"
import { ChatSession } from "@/lib/types"
import { useState } from "react"
import { SignedIn, SignedOut, SignInButton, UserButton, useUser } from "@clerk/nextjs"

interface SidebarProps {
  activeTab: string
  setActiveTab: (tab: string) => void
  sessions: ChatSession[]
  isLoading?: boolean
  activeSessionId: string
  onSessionSelect: (id: string) => void
  onNewChat: () => void
}

export function Sidebar({
  activeTab,
  setActiveTab,
  sessions,
  isLoading = false,
  activeSessionId,
  onSessionSelect,
  onNewChat,
  userRole = "NOT_ASSIGN" // Default safe role
}: SidebarProps & { userRole?: string }) {
  const { isOpen, setIsOpen } = useMobileMenu()
  const [isChatExpanded, setIsChatExpanded] = useState(true)
  const { user } = useUser()

  const menuItems = [
    {
      id: "chat",
      label: "Trợ lý AI",
      icon: MessageSquare,
      roles: ["Admin", "Manager", "Sales", "Technician"]
    },
    {
      id: "knowledge",
      label: "Nạp Tri thức",
      icon: BookOpen,
      roles: ["Admin", "Manager"] // Only Admin and Manager can upload knowledge
    },
    {
      id: "scheduling",
      label: "Lịch hẹn",
      icon: Calendar,
      roles: ["Admin", "Manager", "Sales", "Technician"]
    },
    {
      id: "reports",
      label: "Báo cáo",
      icon: FileText,
      roles: ["Admin", "Manager", "Technician"] // Sales hidden
    },
    {
      id: "storage",
      label: "Tồn kho",
      icon: Archive,
      roles: ["Admin", "Manager", "Sales"] // Technician hidden
    },
    {
      id: "customers",
      label: "Khách hàng",
      icon: Users,
      roles: ["Admin", "Manager"]
    },
    {
      id: "users",
      label: "Nhân sự",
      icon: UserCog,
      roles: ["Admin"]
    }
  ]

  // Filter items based on role
  const visibleItems = menuItems.filter(item => item.roles.includes(userRole))

  const handleTabClick = (tabId: string) => {
    setActiveTab(tabId)
    // Only close mobile menu if it's NOT the chat tab (because chat tab might need further interaction)
    // Actually, on mobile, if they click "Trợ lý AI", maybe we just expand?
    // Let's keep specific behavior for chat
    if (tabId === "chat") {
      setIsChatExpanded(!isChatExpanded)
    } else {
      setIsOpen(false)
    }
  }

  return (
    <>
      {/* Backdrop - only visible on mobile when menu is open */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden transition-opacity duration-300"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed md:relative inset-y-0 left-0 z-50
        w-64 md:w-64
        bg-sidebar border-r border-sidebar-border flex flex-col
        transform transition-transform duration-300 ease-in-out
        ${isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
      `}>
        {/* Header */}
        <div className="p-6 border-b border-sidebar-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-sidebar-primary flex items-center justify-center">
                <span className="text-sidebar-primary-foreground font-bold text-lg">AI</span>
              </div>
              <div>
                <h1 className="font-bold text-sidebar-foreground">Sutra AI</h1>
                <p className="text-xs text-sidebar-foreground/60">Operating System</p>
                {/* Debug Role */}
                {/* <p className="text-[10px] text-sidebar-foreground/40">{userRole}</p> */}
              </div>
            </div>
            {/* Close button - only visible on mobile */}
            <button
              onClick={() => setIsOpen(false)}
              className="md:hidden p-2 hover:bg-sidebar-accent rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-sidebar-foreground" />
            </button>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
          {visibleItems.map((item) => {
            const Icon = item.icon
            const isActive = activeTab === item.id

            if (item.id === "chat") {
              return (
                <div key={item.id} className="space-y-1">
                  <button
                    onClick={() => handleTabClick(item.id)}
                    className={`w-full flex items-center justify-between px-4 py-3 rounded-lg transition-colors ${isActive
                      ? "bg-sidebar-primary/10 text-sidebar-primary"
                      : "text-sidebar-foreground hover:bg-sidebar-accent"
                      }`}
                  >
                    <div className="flex items-center gap-3">
                      <Icon className="w-5 h-5" />
                      <span className="text-sm font-medium">{item.label}</span>
                    </div>
                    {isChatExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </button>

                  {/* Chat History Sub-menu */}
                  {isChatExpanded && (
                    <div className="pl-4 space-y-1 animate-in slide-in-from-top-2 duration-200">
                      <button
                        onClick={() => {
                          onNewChat()
                          setIsOpen(false)
                        }}
                        className="w-full flex items-center gap-2 px-4 py-2 text-xs font-medium text-sidebar-foreground/70 hover:text-sidebar-primary hover:bg-sidebar-accent rounded-md"
                      >
                        <Plus className="w-3 h-3" />
                        Cuộc hội thoại mới
                      </button>

                      <div className="space-y-0.5 mt-1 max-h-[300px] overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-sidebar-border">
                        {isLoading ? (
                          <div className="flex items-center justify-center py-4 text-sidebar-foreground/50">
                            <Loader2 className="w-4 h-4 animate-spin" />
                          </div>
                        ) : sessions.length === 0 ? (
                          <div className="px-4 py-2 text-xs text-sidebar-foreground/40 italic">Chưa có lịch sử</div>
                        ) : (
                          sessions.map(session => (
                            <button
                              key={session.id}
                              onClick={() => {
                                onSessionSelect(session.id)
                                setIsOpen(false)
                              }}
                              className={`w-full text-left px-4 py-2 text-xs truncate rounded-md transition-colors ${activeSessionId === session.id
                                ? "bg-sidebar-primary/20 text-sidebar-primary font-medium"
                                : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                                }`}
                              title={session.summary || session.title || "Cuộc hội thoại"}
                            >
                              {session.summary || session.title || "Cuộc hội thoại"}
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            }

            return (
              <button
                key={item.id}
                onClick={() => handleTabClick(item.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${isActive
                  ? "bg-sidebar-primary text-sidebar-primary-foreground"
                  : "text-sidebar-foreground hover:bg-sidebar-accent"
                  }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-sm font-medium">{item.label}</span>
              </button>
            )
          })}
        </nav>

        {/* Footer */}
        <div className="p-4 border-t border-sidebar-border">
          <SignedIn>
            <div className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-sidebar-accent transition-colors">
              <UserButton
                afterSignOutUrl="/"
                appearance={{
                  elements: {
                    avatarBox: "w-9 h-9"
                  }
                }}
              />
              <div className="flex flex-col overflow-hidden text-left">
                <span className="text-sm font-medium truncate text-sidebar-foreground">
                  {user?.fullName || user?.firstName || "Người dùng"}
                </span>
                <span className="text-xs truncate text-sidebar-foreground/60 leading-none mt-1">
                  {user?.primaryEmailAddress?.emailAddress}
                </span>
              </div>
            </div>
          </SignedIn>
          <SignedOut>
            <SignInButton mode="modal">
              <button className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sidebar-foreground hover:bg-sidebar-accent transition-colors">
                <LogOut className="w-5 h-5" />
                <span className="text-sm font-medium">Đăng nhập</span>
              </button>
            </SignInButton>
          </SignedOut>
        </div>
      </aside>
    </>
  )
}

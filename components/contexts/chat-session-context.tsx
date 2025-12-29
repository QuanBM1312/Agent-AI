"use client"

import React, { createContext, useContext, useState, useEffect, useCallback } from "react"
import { useUser } from "@clerk/nextjs"
import { ChatSession } from "@/lib/types"

interface ChatSessionContextType {
  sessions: ChatSession[]
  isLoading: boolean
  refreshSessions: () => Promise<void>
}

const ChatSessionContext = createContext<ChatSessionContextType | undefined>(undefined)

export function ChatSessionProvider({ children }: { children: React.ReactNode }) {
  const { user, isLoaded } = useUser()
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [isLoading, setIsLoading] = useState(false)

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
    if (isLoaded && user) {
      fetchSessions()
    }
  }, [isLoaded, user, fetchSessions])

  return (
    <ChatSessionContext.Provider value={{ sessions, isLoading, refreshSessions: fetchSessions }}>
      {children}
    </ChatSessionContext.Provider>
  )
}

export function useChatSessions() {
  const context = useContext(ChatSessionContext)
  if (context === undefined) {
    throw new Error("useChatSessions must be used within a ChatSessionProvider")
  }
  return context
}

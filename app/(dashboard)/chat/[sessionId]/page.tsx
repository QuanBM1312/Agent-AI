"use client"

import { ChatInterface } from "@/components/chat-interface"
import { useParams } from "next/navigation"
import { useChatSessions } from "@/components/contexts/chat-session-context"

export default function ChatSessionPage() {
  const params = useParams()
  const sessionId = params.sessionId as string
  const { refreshSessions } = useChatSessions()

  return (
    <ChatInterface
      activeSessionId={sessionId}
      onMessageSent={refreshSessions}
    />
  )
}

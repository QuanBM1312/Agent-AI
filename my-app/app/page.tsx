"use client"

import { useState } from "react"
import { Sidebar } from "@/components/sidebar"
import { ChatInterface } from "@/components/chat-interface"
import { KnowledgePortal } from "@/components/knowledge-portal"
import { SchedulingPanel } from "@/components/scheduling-panel"
import { StoragePanel } from "@/components/storage-panel"

export default function Home() {
  const [activeTab, setActiveTab] = useState("chat")

  return (
    <div className="flex h-screen bg-background">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />

      <main className="flex-1 overflow-hidden">
        {activeTab === "chat" && <ChatInterface />}
        {activeTab === "knowledge" && <KnowledgePortal />}
        {activeTab === "scheduling" && <SchedulingPanel />}
        {activeTab === "storage" && <StoragePanel />}
      </main>
    </div>
  )
}

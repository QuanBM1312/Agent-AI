"use client"

import { useState, useRef, useEffect } from "react"
import { Send, Loader2, Paperclip, Mic } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

interface Message {
  id: string
  role: "user" | "assistant"
  content: string
  timestamp: Date
}

export function ChatInterface() {
  // Tạo session ID ngẫu nhiên cho mỗi lần refresh trang (hoặc có thể lấy từ URL/localStorage)
  const [sessionId] = useState(() => `session-${Date.now()}`)
  
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      role: "assistant",
      content:
        "Xin chào! Tôi là Trợ lý AI của bạn. Tôi có thể giúp bạn tra cứu thông tin, tạo lịch hẹn, hoặc trả lời các câu hỏi về quy trình vận hành. Bạn cần gì?",
      timestamp: new Date(),
    },
  ])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const handleSendMessage = async () => {
    if (!input.trim() || isLoading) return

    const userContent = input
    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: userContent,
      timestamp: new Date(),
    }

    // 1. Hiển thị tin nhắn của user ngay lập tức
    setMessages((prev) => [...prev, userMessage])
    setInput("")
    setIsLoading(true)

    try {
      // 2. Gọi API Chat Internal
      const response = await fetch("/api/chat/internal", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          chatInput: userContent,
          sessionId: sessionId, 
        }),
      })

      if (!response.ok) {
        throw new Error("Failed to send message")
      }

      const data = await response.json()
      
      // Giả sử API n8n trả về cấu trúc: { output: "Câu trả lời của AI" }
      // Hoặc nếu trả về { message: "..." } thì bạn sửa lại dòng dưới
      const aiContent = data.output || data.message || JSON.stringify(data)

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: aiContent,
        timestamp: new Date(),
      }

      setMessages((prev) => [...prev, assistantMessage])
    } catch (error) {
      console.error("Chat error:", error)
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: "Xin lỗi, tôi đang gặp sự cố kết nối. Vui lòng thử lại sau.",
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, errorMessage])
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="border-b border-border p-6">
        <h2 className="text-2xl font-bold text-foreground">Trợ lý Tri thức Tương tác</h2>
        <p className="text-sm text-muted-foreground mt-1">Hỏi bất cứ điều gì về quy trình, tồn kho, hoặc công việc</p>
        <p className="text-xs text-muted-foreground/50 mt-1">Session ID: {sessionId}</p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {messages.map((message) => (
          <div key={message.id} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-md lg:max-w-2xl px-4 py-3 rounded-lg ${
                message.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-card border border-border text-foreground"
              }`}
            >
              <p className="text-sm whitespace-pre-wrap">{message.content}</p>
              <span className="text-xs opacity-70 mt-2 block">
                {message.timestamp.toLocaleTimeString("vi-VN", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-card border border-border px-4 py-3 rounded-lg">
              <Loader2 className="w-5 h-5 animate-spin text-primary" />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-border p-6 bg-card">
        <div className="flex gap-3">
          <button className="p-2 hover:bg-muted rounded-lg transition-colors">
            <Paperclip className="w-5 h-5 text-muted-foreground" />
          </button>
          <button className="p-2 hover:bg-muted rounded-lg transition-colors">
            <Mic className="w-5 h-5 text-muted-foreground" />
          </button>
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={(e) => e.key === "Enter" && handleSendMessage()}
            placeholder="Nhập câu hỏi của bạn..."
            className="flex-1"
            disabled={isLoading}
          />
          <Button
            onClick={handleSendMessage}
            disabled={isLoading || !input.trim()}
            className="bg-primary hover:bg-primary/90"
          >
            <Send className="w-5 h-5" />
          </Button>
        </div>
      </div>
    </div>
  )
}

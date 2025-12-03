"use client"

import { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Plus, MessageSquare, MoreVertical, Send, Paperclip, Bot, User, Mic, Loader2 } from "lucide-react"
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism'

// --- 1. Types Definition ---
type Role = "user" | "assistant"

interface Message {
  id: string
  role: Role
  content: string
  timestamp: Date
  citations?: string[]
}

interface ChatSession {
  id: string
  title: string
  updatedAt: Date
  preview: string
}

// --- 2. Sub-components ---

// Component: Sidebar hiển thị lịch sử
function ChatSidebar({ 
  sessions, 
  activeId, 
  onSelect, 
  onNew 
}: { 
  sessions: ChatSession[], 
  activeId: string, 
  onSelect: (id: string) => void, 
  onNew: () => void 
}) {
  return (
    <div className="hidden md:flex w-80 border-l border-border bg-muted/10 flex-col h-full">
      <div className="p-4 border-b border-border">
        <Button onClick={onNew} className="w-full justify-start gap-2" variant="outline">
          <Plus className="w-4 h-4" /> Cuộc hội thoại mới
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {sessions.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground p-4">Chưa có lịch sử chat</div>
        ) : (
            sessions.map(session => (
            <button
                key={session.id}
                onClick={() => onSelect(session.id)}
                className={`w-full text-left p-3 rounded-lg text-sm transition-colors flex gap-3 items-start
                ${activeId === session.id ? "bg-primary/10 text-primary" : "hover:bg-muted"}`}
            >
                <MessageSquare className="w-4 h-4 mt-1 shrink-0 opacity-70" />
                <div className="overflow-hidden">
                <div className="font-medium truncate">{session.title}</div>
                <div className="text-xs text-muted-foreground truncate">{session.preview}</div>
                </div>
            </button>
            ))
        )}
      </div>
    </div>
  )
}

// Component: Hiển thị một tin nhắn
function MessageItem({ message }: { message: Message }) {
  const isAI = message.role === "assistant"
  
  // Cấu hình màu sắc khác nhau cho AI (nền sáng) và User (nền màu)
  const components = {
    code({node, inline, className, children, ...props}: any) {
      const match = /language-(\w+)/.exec(className || '')
      return !inline && match ? (
        <SyntaxHighlighter
          style={isAI ? oneDark : oneLight} // User dùng theme sáng cho code
          language={match[1]}
          PreTag="div"
          className="rounded-md my-2 shadow-sm border border-border"
          customStyle={{ backgroundColor: isAI ? '#1e1e1e' : '#ffffff', fontSize: '0.8rem' }}
          {...props}
        >
          {String(children).replace(/\n$/, '')}
        </SyntaxHighlighter>
      ) : (
        <code className={`${className} px-1 py-0.5 rounded font-mono text-xs ${
            isAI ? "bg-pink-100 text-pink-600" : "bg-blue-700 text-white border border-blue-500"
        }`} {...props}>
          {children}
        </code>
      )
    },
    h1: ({node, ...props}: any) => <h1 className={`text-lg font-bold mt-4 mb-2 ${isAI ? "text-blue-600" : "text-white"}`} {...props} />,
    h2: ({node, ...props}: any) => <h2 className={`text-base font-bold mt-3 mb-2 ${isAI ? "text-indigo-600" : "text-white"}`} {...props} />,
    h3: ({node, ...props}: any) => <h3 className={`text-sm font-bold mt-2 mb-1 ${isAI ? "text-purple-600" : "text-white"}`} {...props} />,
    a: ({node, ...props}: any) => <a className={`underline ${isAI ? "text-blue-500 hover:text-blue-700" : "text-blue-100 hover:text-white"}`} target="_blank" rel="noopener noreferrer" {...props} />,
    ul: ({node, ...props}: any) => <ul className="list-disc pl-4 my-2 space-y-1" {...props} />,
    ol: ({node, ...props}: any) => <ol className="list-decimal pl-4 my-2 space-y-1" {...props} />,
    blockquote: ({node, ...props}: any) => <blockquote className={`border-l-4 pl-4 py-1 my-2 italic ${isAI ? "border-orange-400 bg-orange-50 text-muted-foreground" : "border-white/50 bg-white/10"}`} {...props} />,
    table: ({node, ...props}: any) => <div className="overflow-x-auto my-2"><table className={`min-w-full divide-y rounded-md ${isAI ? "divide-border border border-border" : "divide-white/20 border border-white/20"}`} {...props} /></div>,
    th: ({node, ...props}: any) => <th className={`px-3 py-2 text-left text-xs font-medium uppercase tracking-wider ${isAI ? "bg-muted/50 text-muted-foreground" : "bg-white/10 text-white"}`} {...props} />,
    td: ({node, ...props}: any) => <td className={`px-3 py-2 whitespace-nowrap text-sm ${isAI ? "border-t border-border" : "border-t border-white/10"}`} {...props} />,
  }

  return (
    <div className={`flex w-full ${isAI ? "justify-start" : "justify-end"} px-4 py-2`}>
      <div className={`max-w-[90%] lg:max-w-[80%] rounded-lg px-4 py-3 ${
        isAI 
          ? "bg-muted/50 border border-border" 
          : "bg-primary text-primary-foreground"
      }`}>
        <div className="flex items-center gap-2 mb-1">
          {isAI && <Bot className="w-4 h-4 opacity-70" />}
          <span className={`text-xs font-medium ${isAI ? "opacity-70" : "opacity-90"}`}>
            {isAI ? "Trợ lý Sutra" : "Bạn"}
          </span>
          <span className={`text-[10px] ${isAI ? "opacity-50" : "opacity-70"}`}>
            {message.timestamp.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>
        
        <div className={`text-sm leading-relaxed overflow-hidden ${isAI ? "markdown-body" : ""}`}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={components}
            >
              {message.content}
            </ReactMarkdown>
        </div>

        {isAI && message.citations && message.citations.length > 0 && (
          <div className="mt-3 pt-3 border-t border-border/50">
            <p className="text-[10px] uppercase tracking-wider opacity-60 mb-2 font-semibold">Nguồn tham khảo:</p>
            <div className="flex flex-wrap gap-2">
              {message.citations.map((cite, idx) => (
                <span key={idx} className="text-xs bg-background/50 px-2 py-1 rounded border border-border/50 flex items-center gap-1">
                  <Paperclip className="w-3 h-3" /> {cite}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// --- 3. Main Component ---
export function ChatInterface() {
  const [sessions, setSessions] = useState<ChatSession[]>([]) 
  const [activeSessionId, setActiveSessionId] = useState<string>(() => `session-${Date.now()}`)
  
  // INIT MESSAGE: Thêm mẫu Markdown vào đây để test ngay
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      role: "assistant",
      content: "Xin chào! Tôi là Trợ lý AI của bạn. Tôi có thể giúp bạn tra cứu thông tin, tạo lịch hẹn, hoặc trả lời các câu hỏi về quy trình vận hành. Bạn cần gì?",
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

  const handleNewSession = () => {
    const newSessionId = `session-${Date.now()}`
    setActiveSessionId(newSessionId)
    setMessages([
        {
            id: Date.now().toString(),
            role: "assistant",
            content: "Xin chào! Chúng ta bắt đầu cuộc hội thoại mới nhé. Bạn cần giúp gì?",
            timestamp: new Date(),
        }
    ])
  }

  const handleSendMessage = async () => {
    if (!input.trim() || isLoading) return

    const userContent = input
    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: userContent,
      timestamp: new Date(),
    }

    setMessages((prev) => [...prev, userMessage])
    setInput("")
    setIsLoading(true)

    // Mock session update
    setSessions(prev => {
        const existing = prev.find(s => s.id === activeSessionId)
        if (existing) {
            return prev.map(s => s.id === activeSessionId ? { ...s, preview: userContent, updatedAt: new Date() } : s)
        }
        return [{
            id: activeSessionId,
            title: userContent.slice(0, 30) + (userContent.length > 30 ? "..." : ""),
            preview: userContent,
            updatedAt: new Date()
        }, ...prev]
    })

    try {
      const response = await fetch("/api/chat/internal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatInput: userContent,
          sessionId: activeSessionId, 
        }),
      })

      if (!response.ok) {
        throw new Error("Failed to send message")
      }

      const data = await response.json()
      
      const aiContent = data.output || data.message || JSON.stringify(data)
      const citations = data.citations || [] 

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: aiContent,
        timestamp: new Date(),
        citations: citations
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
    <div className="flex h-full bg-background overflow-hidden">
      <div className="flex-1 flex flex-col min-w-0 border-r border-border">
        <div className="border-b border-border p-6">
          <h2 className="text-2xl font-bold text-foreground">Trợ lý Tri thức Tương tác</h2>
          <p className="text-sm text-muted-foreground mt-1">Hỏi bất cứ điều gì về quy trình, tồn kho, hoặc công việc</p>
          <p className="text-xs text-muted-foreground/50 mt-1">Session ID: {activeSessionId}</p>
        </div>

        <div className="flex-1 overflow-y-auto scroll-smooth">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-8 text-muted-foreground">
              <Bot className="w-12 h-12 mb-4 opacity-20" />
              <h3 className="text-lg font-medium text-foreground mb-2">Tôi có thể giúp gì cho bạn hôm nay?</h3>
              <div className="grid grid-cols-2 gap-2 mt-6 max-w-md w-full">
                {["Tra cứu quy trình", "Tạo lịch hẹn mới", "Kiểm tra tồn kho", "Viết báo cáo"].map(label => (
                  <button key={label} onClick={() => setInput(label)} className="p-3 text-xs border rounded-lg hover:bg-muted transition-colors text-left">
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col py-4 space-y-4">
              {messages.map(msg => (
                <MessageItem key={msg.id} message={msg} />
              ))}
              {isLoading && (
                <div className="flex justify-start px-4">
                    <div className="bg-muted/50 border border-border rounded-lg px-4 py-3 flex items-center gap-2">
                        <Bot className="w-4 h-4 opacity-70" />
                        <Loader2 className="w-3 h-3 animate-spin" />
                        <span className="text-xs text-muted-foreground">Đang suy nghĩ...</span>
                    </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

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

      {/* <ChatSidebar 
        sessions={sessions} 
        activeId={activeSessionId} 
        onSelect={setActiveSessionId} 
        onNew={handleNewSession}
      /> */}
    </div>
  )
}

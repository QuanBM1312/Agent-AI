"use client"

import { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Plus, Send, Paperclip, Bot, User, Mic, Square, Loader2, X, Image as ImageIcon } from "lucide-react"
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { useMediaRecorder } from "@/hooks/use-media-recorder"
import { MobileMenuButton } from "@/components/mobile-menu-button"
import { useUser } from "@clerk/nextjs"
import { ChatSession } from "@/lib/types"
import { v4 as uuidv4 } from 'uuid'

// --- 1. Types Definition ---
type Role = "user" | "assistant"

interface Message {
  id: string
  role: Role
  content: string
  timestamp: Date
  citations?: string[]
  fileUrl?: string
  fileType?: "image" | "voice"
}

// --- 2. Sub-components ---

// Component: Hiển thị một tin nhắn
function MessageItem({ message }: { message: Message }) {
  const isAI = message.role === "assistant"

  // Cấu hình màu sắc khác nhau cho AI (nền sáng) và User (nền màu)
  const components = {
    code({ node, inline, className, children, ...props }: any) {
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
        <code className={`${className} px-1 py-0.5 rounded font-mono text-xs ${isAI ? "bg-pink-100 text-pink-600" : "bg-blue-700 text-white border border-blue-500"
          }`} {...props}>
          {children}
        </code>
      )
    },
    h1: ({ node, ...props }: any) => <h1 className={`text-lg font-bold mt-4 mb-2 ${isAI ? "text-blue-600" : "text-white"}`} {...props} />,
    h2: ({ node, ...props }: any) => <h2 className={`text-base font-bold mt-3 mb-2 ${isAI ? "text-indigo-600" : "text-white"}`} {...props} />,
    h3: ({ node, ...props }: any) => <h3 className={`text-sm font-bold mt-2 mb-1 ${isAI ? "text-purple-600" : "text-white"}`} {...props} />,
    a: ({ node, ...props }: any) => <a className={`underline ${isAI ? "text-blue-500 hover:text-blue-700" : "text-blue-100 hover:text-white"}`} target="_blank" rel="noopener noreferrer" {...props} />,
    ul: ({ node, ...props }: any) => <ul className="list-disc pl-4 my-2 space-y-1" {...props} />,
    ol: ({ node, ...props }: any) => <ol className="list-decimal pl-4 my-2 space-y-1" {...props} />,
    blockquote: ({ node, ...props }: any) => <blockquote className={`border-l-4 pl-4 py-1 my-2 italic ${isAI ? "border-orange-400 bg-orange-50 text-muted-foreground" : "border-white/50 bg-white/10"}`} {...props} />,
    table: ({ node, ...props }: any) => <div className="overflow-x-auto my-2"><table className={`min-w-full divide-y rounded-md ${isAI ? "divide-border border border-border" : "divide-white/20 border border-white/20"}`} {...props} /></div>,
    th: ({ node, ...props }: any) => <th className={`px-3 py-2 text-left text-xs font-medium uppercase tracking-wider ${isAI ? "bg-muted/50 text-muted-foreground" : "bg-white/10 text-white"}`} {...props} />,
    td: ({ node, ...props }: any) => <td className={`px-3 py-2 whitespace-nowrap text-sm ${isAI ? "border-t border-border" : "border-t border-white/10"}`} {...props} />,
  }

  return (
    <div className={`flex w-full ${isAI ? "justify-start" : "justify-end"} px-4 py-2`}>
      <div className={`max-w-[90%] lg:max-w-[80%] rounded-lg px-4 py-3 ${isAI
        ? "bg-muted/50 border border-border"
        : "bg-primary text-primary-foreground"
        }`}>
        <div className="flex items-center gap-2 mb-1">
          {isAI && <Bot className="w-4 h-4 opacity-70" />}
          <span className={`text-xs font-medium ${isAI ? "opacity-70" : "opacity-90"}`}>
            {isAI ? "Trợ lý Sutra" : "Bạn"}
          </span>
          <span className={`text-[10px] ${isAI ? "opacity-50" : "opacity-70"}`}>
            {new Date(message.timestamp).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>

        <div className={`text-sm leading-relaxed overflow-hidden ${isAI ? "markdown-body" : ""}`}>
          {message.fileUrl && message.fileType === "image" && (
            <div className="mb-3">
              <img
                src={message.fileUrl}
                alt="Uploaded content"
                className="max-w-full rounded-lg border border-border/50 shadow-sm max-h-[300px] object-cover"
              />
            </div>
          )}

          {message.fileUrl && message.fileType === "voice" && (
            <div className="mb-3">
              <audio controls src={message.fileUrl} className="w-full max-w-[240px]" />
            </div>
          )}

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
interface ChatInterfaceProps {
  activeSessionId: string
  onMessageSent: () => void
}

export function ChatInterface({ activeSessionId, onMessageSent }: ChatInterfaceProps) {
  const { user } = useUser()

  // Media Recorder Hook
  const { isRecording, mediaBlob, startRecording, stopRecording, clearRecording } = useMediaRecorder()

  // Image Upload State
  const [selectedImage, setSelectedImage] = useState<File | null>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)

  // INIT MESSAGE
  const [messages, setMessages] = useState<Message[]>([])

  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Flag to trigger send after recording stops
  const shouldSendAfterStop = useRef(false)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  // --- Data Fetching ---

  // Fetch Messages for Active Session
  useEffect(() => {
    const loadMessages = async () => {
      if (!activeSessionId) return

      // Optimistically set loading but don't clear messages immediately to avoid flash if switching quickly
      setIsLoading(true)
      // Reset messages if switching sessions, or keep them? better reset or have loading state
      // setMessages([]) // Optional: clear previous messages

      try {
        const res = await fetch(`/api/chat/messages?session_id=${activeSessionId}`)
        if (res.ok) {
          const data = await res.json()
          const messagesData = data.data || []
          // If no messages found, it might be truly empty or new.
          if (Array.isArray(messagesData) && messagesData.length > 0) {
            setMessages(messagesData)
          } else {
            // Default welcome for empty/new
            setMessages([{
              id: "welcome",
              role: "assistant",
              content: "Xin chào! Tôi là Trợ lý AI. Bạn cần giúp gì?",
              timestamp: new Date()
            }])
          }
        }
      } catch (e) {
        console.error("Failed to fetch messages", e)
      } finally {
        setIsLoading(false)
      }
    }

    loadMessages()
  }, [activeSessionId])

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const clearMedia = () => {
    clearRecording()
    setSelectedImage(null)
    if (imageInputRef.current) imageInputRef.current.value = ""
  }

  const handleSendMessage = async () => {
    // If recording, stop it and flag to send immediately after
    if (isRecording) {
      shouldSendAfterStop.current = true
      stopRecording()
      return
    }

    if ((!input.trim() && !mediaBlob && !selectedImage) || isLoading) return

    setIsLoading(true)

    const clientMessageId = uuidv4() // Generate unique ID for this specific message attempt

    // Build FormData for n8n/API
    const formData = new FormData()
    formData.append("sessionId", activeSessionId)
    formData.append("clientMessageId", clientMessageId) // <--- Add Deduplication ID
    // Pass User ID if available, otherwise backend might fail or fallback
    if (user?.id) formData.append("userId", user.id)
    console.log("User ID:", user?.id)
    console.log("Client Message ID:", clientMessageId)

    let userDisplayContent = ""

    if (mediaBlob) {
      formData.append("file", mediaBlob, "recording.webm")
      formData.append("type", "voice")
      userDisplayContent += "🎤 [Ghi âm giọng nói]"
    } else if (selectedImage) {
      formData.append("file", selectedImage)
      formData.append("type", "image")
      userDisplayContent += `🖼️ [Hình ảnh: ${selectedImage.name}]`
    } else {
      formData.append("type", "chat")
    }

    if (input.trim()) {
      formData.append("chatInput", input)
      userDisplayContent += userDisplayContent ? `\n${input}` : input
    }

    // Optimistic UI Update
    let fileUrl = undefined
    let fileType: "image" | "voice" | undefined = undefined

    if (mediaBlob) {
      fileUrl = URL.createObjectURL(mediaBlob)
      fileType = "voice"
    } else if (selectedImage) {
      fileUrl = URL.createObjectURL(selectedImage)
      fileType = "image"
    }

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: userDisplayContent,
      timestamp: new Date(),
      fileUrl,
      fileType
    }
    setMessages((prev) => [...prev, userMessage])
    setInput("")

    // Clear media states immediately after sending (optimistic)
    const currentMediaBlob = mediaBlob
    const currentSelectedImage = selectedImage
    clearMedia()

    try {
      // Use the n8n proxy route
      const response = await fetch("/api/chat/n8n", {
        method: "POST",
        body: formData, // fetch automatically sets Content-Type boundary
      })

      if (!response.ok) {
        throw new Error("Failed to send message")
      }

      const data = await response.json()

      // Handle response - assume standard output structure
      const aiContent = data.output || data.text || data.message || data.description || data.answer || JSON.stringify(data)

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: aiContent,
        timestamp: new Date(),
        citations: data.citations || []
      }

      setMessages((prev) => [...prev, assistantMessage])

      // Notify parent to refresh session list (e.g. title might change)
      if (onMessageSent) onMessageSent()

    } catch (error) {
      console.error("Chat error:", error)
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: "Xin lỗi, tôi gặp lỗi khi xử lý yêu cầu. Vui lòng thử lại.",
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, errorMessage])
    } finally {
      setIsLoading(false)
    }
  }

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedImage(e.target.files[0])
      clearRecording()
    }
  }

  // Effect to handle "Send to Stop" logic
  useEffect(() => {
    if (mediaBlob && shouldSendAfterStop.current) {
      shouldSendAfterStop.current = false
      handleSendMessage()
    }
  }, [mediaBlob])

  return (
    <div className="flex h-full bg-background overflow-hidden">
      {/* Sidebar was removed from here */}

      <div className="flex-1 flex flex-col min-w-0">
        <div className="border-b border-border p-3 md:p-6">
          <div className="flex items-start gap-3">
            {/* Mobile Menu Button - integrated with title */}
            <MobileMenuButton className="-ml-1 mt-0.5" />

            <div className="flex-1 min-w-0">
              <h2 className="text-xl md:text-2xl font-bold text-foreground">Trợ lý Đa phương thức</h2>
              <p className="text-xs md:text-sm text-muted-foreground mt-1">Hỗ trợ Chat, Voice (Whisper) và Nhận diện ảnh (OCR)</p>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[10px] md:text-xs text-muted-foreground/50 truncate max-w-[200px] md:max-w-none">Session ID: {activeSessionId}</span>
                <div className={`w-2 h-2 rounded-full shrink-0 ${isLoading ? "bg-yellow-400 animate-pulse" : "bg-green-400"}`} />
              </div>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto scroll-smooth">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-8 text-muted-foreground">
              <Bot className="w-12 h-12 mb-4 opacity-20" />
              <h3 className="text-lg font-medium text-foreground mb-2">Tôi có thể giúp gì cho bạn hôm nay?</h3>
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
                    <span className="text-xs text-muted-foreground">Đang xử lý đa phương thức...</span>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        <div className="border-t border-border p-3 md:p-6 bg-card">
          {/* Media Previews */}
          {(mediaBlob || selectedImage) && (
            <div className="mb-4 p-3 bg-muted/30 border border-border rounded-lg flex items-center justify-between">
              <div className="flex items-center gap-3 w-full overflow-hidden">
                {mediaBlob && (
                  <div className="flex items-center gap-3 w-full">
                    <div className="relative">
                      <Mic className="w-5 h-5 text-red-500 animate-pulse" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium mb-1">Ghi âm: {(mediaBlob.size / 1024).toFixed(1)} KB</p>
                      <audio controls src={URL.createObjectURL(mediaBlob)} className="w-full h-8" />
                    </div>
                  </div>
                )}
                {selectedImage && (
                  <div className="flex items-center gap-3">
                    <div className="relative w-16 h-16 rounded overflow-hidden border border-border">
                      <img
                        src={URL.createObjectURL(selectedImage)}
                        alt="Preview"
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div>
                      <span className="text-sm font-medium block">{selectedImage.name}</span>
                      <span className="text-xs text-muted-foreground">{(selectedImage.size / 1024).toFixed(1)} KB</span>
                    </div>
                  </div>
                )}
              </div>
              <button onClick={clearMedia} className="p-2 hover:bg-muted rounded-full shrink-0 ml-2">
                <X className="w-4 h-4 opacity-70" />
              </button>
            </div>
          )}

          <div className="flex gap-2 md:gap-3">
            {/* Image Upload Input (Hidden) */}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              ref={imageInputRef}
              onChange={handleImageSelect}
            />

            <button
              onClick={() => imageInputRef.current?.click()}
              className={`p-3 md:p-2 rounded-lg transition-colors min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 flex items-center justify-center ${selectedImage ? "bg-blue-100 text-blue-600" : "hover:bg-muted text-muted-foreground"}`}
              title="Tải ảnh lên"
            >
              <Paperclip className="w-5 h-5" />
            </button>

            {/* Voice Recorder Button */}
            {/* Voice Recorder Button */}
            <button
              onClick={isRecording ? stopRecording : startRecording}
              className={`p-3 md:p-2 rounded-lg transition-colors min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 flex items-center justify-center ${isRecording ? "bg-red-100 text-red-600 animate-pulse border border-red-200" : "hover:bg-muted text-muted-foreground"}`}
              title={isRecording ? "Dừng ghi âm" : "Nhấn để ghi âm"}
            >
              {isRecording ? (
                <Square className="w-5 h-5 fill-current" />
              ) : (
                <Mic className="w-5 h-5" />
              )}
            </button>

            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={(e) => e.key === "Enter" && handleSendMessage()}
              placeholder="Nhập tin nhắn..."
              className="flex-1 min-h-[44px]"
              disabled={isLoading || isRecording}
            />
            <Button
              onClick={handleSendMessage}
              disabled={isLoading || (!input.trim() && !mediaBlob && !selectedImage && !isRecording)}
              className="bg-primary hover:bg-primary/90 min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 px-3 md:px-4"
            >
              <Send className="w-5 h-5" />
            </Button>
          </div>
          <div className="text-[10px] md:text-xs text-muted-foreground/40 mt-2 text-center">
            Nhấn Microphone để bắt đầu/dừng ghi âm • Chọn Paperclip để gửi ảnh
          </div>
        </div>
      </div>
    </div>
  )
}

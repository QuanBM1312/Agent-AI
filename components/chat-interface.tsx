"use client"

import type { ComponentPropsWithoutRef, ReactNode } from "react"
import { useState, useRef, useEffect, useEffectEvent, useCallback } from "react"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Send, Paperclip, Bot, Mic, Square, X } from "lucide-react"
import ReactMarkdown from 'react-markdown'
import type { Components } from "react-markdown"
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { useMediaRecorder } from "@/hooks/use-media-recorder"
import { MobileMenuButton } from "@/components/mobile-menu-button"
import { useUser } from "@clerk/nextjs"
import {
  buildChatStagePlan,
  ChatRequestKind,
  ChatRequestMetric,
  ChatStageKey,
  createChatRequestId,
  getStageAdvanceDelayMs,
  inferRouteHint,
  recordClientChatMetric,
} from "@/lib/chat-observability"
import { ChatRequestStatus } from "@/components/chat-request-status"
import { ChatTelemetryPanel } from "@/components/chat-telemetry-panel"
import type {
  EvidenceKind,
  EvidenceItem,
  ExecutionTraceEvent,
  MissingDataItem,
  VerificationStatus,
} from "@/lib/answer-contract"

// --- 1. Types Definition ---
type Role = "user" | "assistant"

interface MessageRequestMeta {
  requestId: string
  durationMs?: number
  routeHint?: string
  queryIntent?: string
  stage?: ChatStageKey
  agent0ContextId?: string
  webSearchUsed?: boolean
  webSearchProvider?: string
  webSearchPendingPrompt?: string
  degradedFrom?: string
  verificationStatus?: VerificationStatus
  evidence?: EvidenceItem[]
  missingData?: MissingDataItem[]
  warnings?: string[]
  executionTrace?: ExecutionTraceEvent[]
}

interface Message {
  id: string
  role: Role
  content: string
  timestamp: Date
  citations?: string[]
  fileUrl?: string
  fileType?: "image" | "voice"
  requestMeta?: MessageRequestMeta
}

interface LoadingState {
  requestId: string
  stagePlan: ChatStageKey[]
  startedAt: number
  elapsedMs: number
  type: ChatRequestKind
  hasAttachment: boolean
}

const AGENT0_CONTEXT_STORAGE_PREFIX = "agent0-context:"

interface MarkdownCodeProps extends ComponentPropsWithoutRef<"code"> {
  inline?: boolean
  children?: ReactNode
}

const verificationLabels: Record<VerificationStatus, { label: string; className: string }> = {
  verified: {
    label: "Đã xác minh",
    className: "border-emerald-300 bg-emerald-50 text-emerald-700",
  },
  partial: {
    label: "Một phần",
    className: "border-amber-300 bg-amber-50 text-amber-700",
  },
  missing: {
    label: "Thiếu nguồn",
    className: "border-orange-300 bg-orange-50 text-orange-700",
  },
  tool_unavailable: {
    label: "Chưa đọc được nguồn",
    className: "border-rose-300 bg-rose-50 text-rose-700",
  },
  unverified: {
    label: "Chưa xác minh",
    className: "border-slate-300 bg-slate-50 text-slate-700",
  },
}

function isVerificationStatus(value: unknown): value is VerificationStatus {
  return (
    value === "verified" ||
    value === "partial" ||
    value === "missing" ||
    value === "tool_unavailable" ||
    value === "unverified"
  )
}

function isEvidenceKind(value: unknown): value is EvidenceKind {
  return (
    value === "db" ||
    value === "drive_file" ||
    value === "spreadsheet_row" ||
    value === "vector_chunk" ||
    value === "n8n" ||
    value === "agent0" ||
    value === "web"
  )
}

function sanitizeEvidence(value: unknown): EvidenceItem[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }

  const evidence = value
    .map((item): EvidenceItem | null => {
      if (typeof item !== "object" || item === null) {
        return null
      }

      const record = item as Record<string, unknown>
      const kind = record.kind
      const sourceName = typeof record.sourceName === "string" ? record.sourceName.trim() : ""
      const confidence = record.confidence

      if (!isEvidenceKind(kind) || !sourceName) {
        return null
      }

      return {
        kind,
        sourceName: sourceName.slice(0, 160),
        fileId: typeof record.fileId === "string" ? record.fileId.slice(0, 64) : undefined,
        sheet: typeof record.sheet === "string" ? record.sheet.slice(0, 80) : undefined,
        row: typeof record.row === "number" && Number.isFinite(record.row) ? record.row : undefined,
        dbTable: typeof record.dbTable === "string" ? record.dbTable.slice(0, 120) : undefined,
        field: typeof record.field === "string" ? record.field.slice(0, 80) : undefined,
        confidence:
          confidence === "low" || confidence === "medium" || confidence === "high"
            ? confidence
            : "low",
      }
    })
    .filter((item): item is EvidenceItem => Boolean(item))

  return evidence.length > 0 ? evidence : undefined
}

function shortenIdentifier(value: string) {
  return value.length <= 16 ? value : `${value.slice(0, 8)}...${value.slice(-4)}`
}

function readRequestMeta(raw: unknown): MessageRequestMeta | undefined {
  if (
    typeof raw !== "object" ||
    raw === null ||
    typeof (raw as Record<string, unknown>).requestId !== "string"
  ) {
    return undefined
  }

  const meta = raw as Record<string, unknown>
  return {
    requestId: meta.requestId as string,
    durationMs: typeof meta.durationMs === "number" ? meta.durationMs : undefined,
    routeHint: typeof meta.routeHint === "string" ? meta.routeHint : undefined,
    queryIntent: typeof meta.queryIntent === "string" ? meta.queryIntent : undefined,
    stage: typeof meta.stage === "string" ? (meta.stage as ChatStageKey) : undefined,
    agent0ContextId:
      typeof meta.agent0ContextId === "string" ? meta.agent0ContextId : undefined,
    webSearchUsed:
      typeof meta.webSearchUsed === "boolean" ? meta.webSearchUsed : undefined,
    webSearchProvider:
      typeof meta.webSearchProvider === "string" ? meta.webSearchProvider : undefined,
    webSearchPendingPrompt:
      typeof meta.webSearchPendingPrompt === "string" ? meta.webSearchPendingPrompt : undefined,
    degradedFrom:
      typeof meta.degradedFrom === "string" ? meta.degradedFrom : undefined,
    verificationStatus:
      isVerificationStatus(meta.verificationStatus) ? meta.verificationStatus : undefined,
    evidence: sanitizeEvidence(meta.evidence),
    missingData: Array.isArray(meta.missingData)
      ? (meta.missingData as MissingDataItem[])
      : undefined,
    warnings: Array.isArray(meta.warnings)
      ? meta.warnings.filter((warning): warning is string => typeof warning === "string")
      : undefined,
    executionTrace: Array.isArray(meta.executionTrace)
      ? (meta.executionTrace as ExecutionTraceEvent[])
      : undefined,
  }
}

function ContractBadge({ status }: { status: VerificationStatus }) {
  const config = verificationLabels[status] || verificationLabels.unverified
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${config.className}`}>
      {config.label}
    </span>
  )
}

// --- 2. Sub-components ---

// Component: Hiển thị một tin nhắn
function MessageItem({ message }: { message: Message }) {
  const isAI = message.role === "assistant"
  const usedGeminiWebSearch = isAI && message.requestMeta?.webSearchUsed
  const offeredGeminiWebSearch =
    isAI && message.requestMeta?.routeHint === "gemini_web_offer"
  const routeHint = message.requestMeta?.routeHint || ""
  const verificationStatus = message.requestMeta?.verificationStatus
  const needsData =
    isAI &&
    (Boolean(message.requestMeta?.degradedFrom) ||
      routeHint === "calculation_needs_data" ||
      routeHint === "local_internal_unavailable" ||
      routeHint === "local_business_data_boundary")
  const trace = message.requestMeta?.executionTrace || []
  const evidence = message.requestMeta?.evidence || []
  const missingData = message.requestMeta?.missingData || []
  const warnings = message.requestMeta?.warnings || []

  // Cấu hình màu sắc khác nhau cho AI (nền sáng) và User (nền màu)
  const components: Components = {
    code({ inline, className, children, style: ignoredStyle, ...props }: MarkdownCodeProps) {
      void ignoredStyle
      const match = /language-(\w+)/.exec(className || '')
      return !inline && match ? (
        <SyntaxHighlighter
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
    h1: (props: ComponentPropsWithoutRef<"h1">) => <h1 className={`text-lg font-bold mt-4 mb-2 ${isAI ? "text-blue-600" : "text-white"}`} {...props} />,
    h2: (props: ComponentPropsWithoutRef<"h2">) => <h2 className={`text-base font-bold mt-3 mb-2 ${isAI ? "text-indigo-600" : "text-white"}`} {...props} />,
    h3: (props: ComponentPropsWithoutRef<"h3">) => <h3 className={`text-sm font-bold mt-2 mb-1 ${isAI ? "text-purple-600" : "text-white"}`} {...props} />,
    a: (props: ComponentPropsWithoutRef<"a">) => <a className={`underline ${isAI ? "text-blue-500 hover:text-blue-700" : "text-blue-100 hover:text-white"}`} target="_blank" rel="noopener noreferrer" {...props} />,
    ul: (props: ComponentPropsWithoutRef<"ul">) => <ul className="list-disc pl-4 my-2 space-y-1" {...props} />,
    ol: (props: ComponentPropsWithoutRef<"ol">) => <ol className="list-decimal pl-4 my-2 space-y-1" {...props} />,
    blockquote: (props: ComponentPropsWithoutRef<"blockquote">) => <blockquote className={`border-l-4 pl-4 py-1 my-2 italic ${isAI ? "border-orange-400 bg-orange-50 text-muted-foreground" : "border-white/50 bg-white/10"}`} {...props} />,
    table: (props: ComponentPropsWithoutRef<"table">) => <div className="overflow-x-auto my-2"><table className={`min-w-full divide-y rounded-md ${isAI ? "divide-border border border-border" : "divide-white/20 border border-white/20"}`} {...props} /></div>,
    th: (props: ComponentPropsWithoutRef<"th">) => <th className={`px-3 py-2 text-left text-xs font-medium uppercase tracking-wider ${isAI ? "bg-muted/50 text-muted-foreground" : "bg-white/10 text-white"}`} {...props} />,
    td: (props: ComponentPropsWithoutRef<"td">) => <td className={`px-3 py-2 whitespace-nowrap text-sm ${isAI ? "border-t border-border" : "border-t border-white/10"}`} {...props} />,
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
          {usedGeminiWebSearch && (
            <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
              Gemini Web Search
            </span>
          )}
          {offeredGeminiWebSearch && (
            <span className="rounded-full border border-sky-300 bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-700">
              Có thể tìm web
            </span>
          )}
          {verificationStatus && <ContractBadge status={verificationStatus} />}
          {needsData && (
            <span className="rounded-full border border-orange-300 bg-orange-50 px-2 py-0.5 text-[10px] font-medium text-orange-700">
              Cần dữ liệu xác minh
            </span>
          )}
          <span className={`text-[10px] ${isAI ? "opacity-50" : "opacity-70"}`}>
            {new Date(message.timestamp).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>

        <div className={`text-sm leading-relaxed overflow-hidden ${isAI ? "markdown-body" : ""}`}>
          {message.fileUrl && message.fileType === "image" && (
            <div className="mb-3">
              <Image
                src={message.fileUrl}
                alt="Uploaded content"
                width={640}
                height={320}
                unoptimized
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

        {isAI && message.requestMeta && (
          <div className="mt-3 pt-3 border-t border-border/50 text-[10px] text-muted-foreground">
            <span className="font-mono">req {message.requestMeta.requestId.slice(0, 12)}</span>
            {typeof message.requestMeta.durationMs === "number" && (
              <span> • {Math.round(message.requestMeta.durationMs)} ms</span>
            )}
            {message.requestMeta.routeHint && (
              <span> • {message.requestMeta.routeHint}</span>
            )}
            {message.requestMeta.webSearchProvider && (
              <span> • {message.requestMeta.webSearchProvider}</span>
            )}
            {message.requestMeta.queryIntent && (
              <span> • {message.requestMeta.queryIntent}</span>
            )}
            {(trace.length > 0 || evidence.length > 0 || missingData.length > 0 || warnings.length > 0) && (
              <details className="mt-2 rounded-md border border-border/50 bg-background/40 p-2">
                <summary className="cursor-pointer select-none font-medium text-foreground/70">
                  Trace và dữ liệu
                </summary>
                {evidence.length > 0 && (
                  <div className="mt-2">
                    <p className="font-semibold text-foreground/70">Bằng chứng:</p>
                    <ul className="mt-1 list-disc pl-4">
                      {evidence.map((item, index) => (
                        <li key={`${item.kind}-${item.sourceName}-${index}`}>
                          {item.kind}: {item.sourceName}
                          {item.sheet ? ` / sheet ${item.sheet}` : ""}
                          {typeof item.row === "number" ? ` / dòng ${item.row}` : ""}
                          {item.dbTable ? ` / ${item.dbTable}` : ""}
                          {item.fileId ? ` / file ${shortenIdentifier(item.fileId)}` : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {missingData.length > 0 && (
                  <div className="mt-2">
                    <p className="font-semibold text-foreground/70">Thiếu:</p>
                    <ul className="mt-1 list-disc pl-4">
                      {missingData.map((item, index) => (
                        <li key={`${item.field}-${index}`}>
                          {item.field}: {item.reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {warnings.length > 0 && (
                  <div className="mt-2">
                    <p className="font-semibold text-foreground/70">Cảnh báo:</p>
                    <ul className="mt-1 list-disc pl-4">
                      {warnings.map((warning, index) => (
                        <li key={`${warning}-${index}`}>{warning}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {trace.length > 0 && (
                  <div className="mt-2">
                    <p className="font-semibold text-foreground/70">Các bước:</p>
                    <ol className="mt-1 list-decimal pl-4">
                      {trace.map((event, index) => (
                        <li key={`${event.step}-${index}`}>
                          {event.step}: {event.status}
                          {event.routeHint ? ` (${event.routeHint})` : ""}
                          {event.detail ? ` - ${event.detail}` : ""}
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </details>
            )}
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
  const [selectedImagePreviewUrl, setSelectedImagePreviewUrl] = useState<string | null>(null)
  const [voicePreviewUrl, setVoicePreviewUrl] = useState<string | null>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)

  // INIT MESSAGE
  const [messages, setMessages] = useState<Message[]>([])

  const [input, setInput] = useState("")
  const [isHistoryLoading, setIsHistoryLoading] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [loadingState, setLoadingState] = useState<LoadingState | null>(null)
  const [telemetryEnabled, setTelemetryEnabled] = useState(false)
  const [sessionAgent0ContextIds, setSessionAgent0ContextIds] = useState<Record<string, string>>({})
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const activeRequestControllerRef = useRef<AbortController | null>(null)
  const messageObjectUrlsRef = useRef<Set<string>>(new Set())

  // Flag to trigger send after recording stops
  const shouldSendAfterStop = useRef(false)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  const persistAgent0ContextId = useCallback((sessionId: string, contextId: string) => {
    if (!sessionId || !contextId) return

    setSessionAgent0ContextIds((current) => {
      if (current[sessionId] === contextId) {
        return current
      }

      return {
        ...current,
        [sessionId]: contextId,
      }
    })

    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(
        `${AGENT0_CONTEXT_STORAGE_PREFIX}${sessionId}`,
        contextId,
      )
    }
  }, [])

  const refreshMessages = useCallback(async () => {
    if (!activeSessionId) return

    setIsHistoryLoading(true)

    try {
      const res = await fetch(`/api/chat/messages?session_id=${activeSessionId}`)
      if (res.ok) {
        const data = await res.json()
        const messagesData = data.data || []

        if (Array.isArray(messagesData) && messagesData.length > 0) {
          const normalizedMessages = messagesData.map((rawMessage) => {
            const messageLike = rawMessage as Record<string, unknown>
            const fileType = messageLike.fileType ?? messageLike.file_type

            return {
              id: String(messageLike.id),
              role: messageLike.role === "assistant" ? "assistant" : "user",
              content: String(messageLike.content || ""),
              timestamp: new Date(String(messageLike.timestamp)),
              citations: Array.isArray(messageLike.citations)
                ? (messageLike.citations as string[])
                : undefined,
              fileUrl:
                typeof messageLike.fileUrl === "string"
                  ? messageLike.fileUrl
                  : typeof messageLike.file_url === "string"
                    ? messageLike.file_url
                    : undefined,
              fileType:
                fileType === "image" || fileType === "voice"
                  ? fileType
                  : undefined,
              requestMeta: readRequestMeta(messageLike.requestMeta),
            } satisfies Message
          })
          const latestAssistantWithContext = [...normalizedMessages]
            .reverse()
            .find(
              (message) =>
                message.role === "assistant" &&
                typeof message.requestMeta?.agent0ContextId === "string" &&
                message.requestMeta.agent0ContextId.length > 0,
            )

          if (latestAssistantWithContext?.requestMeta?.agent0ContextId) {
            persistAgent0ContextId(activeSessionId, latestAssistantWithContext.requestMeta.agent0ContextId)
          }
          setMessages(normalizedMessages)
        } else {
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
      setIsHistoryLoading(false)
    }
  }, [activeSessionId, persistAgent0ContextId])

  // --- Data Fetching ---

  // Fetch Messages for Active Session
  useEffect(() => {
    refreshMessages()
  }, [activeSessionId, refreshMessages])

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  useEffect(() => {
    if (typeof window === "undefined") return

    const searchParams = new URLSearchParams(window.location.search)
    const explicitDebug =
      searchParams.get("telemetry") === "1" ||
      searchParams.get("debugTelemetry") === "1"

    setTelemetryEnabled(process.env.NODE_ENV !== "production" || explicitDebug)
  }, [])

  useEffect(() => {
    if (typeof window === "undefined" || !activeSessionId) return

    const storedContextId = window.sessionStorage.getItem(
      `${AGENT0_CONTEXT_STORAGE_PREFIX}${activeSessionId}`,
    )

    if (!storedContextId) {
      return
    }

    setSessionAgent0ContextIds((current) => {
      if (current[activeSessionId] === storedContextId) {
        return current
      }

      return {
        ...current,
        [activeSessionId]: storedContextId,
      }
    })
  }, [activeSessionId])

  useEffect(() => {
    if (!mediaBlob) {
      setVoicePreviewUrl(null)
      return
    }

    const url = URL.createObjectURL(mediaBlob)
    setVoicePreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [mediaBlob])

  useEffect(() => {
    if (!selectedImage) {
      setSelectedImagePreviewUrl(null)
      return
    }

    const url = URL.createObjectURL(selectedImage)
    setSelectedImagePreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [selectedImage])

  useEffect(() => {
    const messageObjectUrls = messageObjectUrlsRef.current
    return () => {
      activeRequestControllerRef.current?.abort()
      for (const url of messageObjectUrls) {
        URL.revokeObjectURL(url)
      }
      messageObjectUrls.clear()
    }
  }, [])

  useEffect(() => {
    const loadingRequestId = loadingState?.requestId
    if (!loadingRequestId) return

    const interval = window.setInterval(() => {
      setLoadingState((current) => {
        if (!current) return current
        return {
          ...current,
          elapsedMs: Date.now() - current.startedAt,
        }
      })
    }, 300)

    return () => window.clearInterval(interval)
  }, [loadingState?.requestId])

  const resolveActiveStage = (state: LoadingState): ChatStageKey => {
    let cumulativeMs = 0

    for (let index = 0; index < state.stagePlan.length; index += 1) {
      const stage = state.stagePlan[index]
      if (index === state.stagePlan.length - 1) {
        return stage
      }

      cumulativeMs += getStageAdvanceDelayMs(stage)
      if (state.elapsedMs < cumulativeMs) {
        return stage
      }
    }

    return state.stagePlan[state.stagePlan.length - 1]
  }

  const clearMedia = () => {
    clearRecording()
    setSelectedImage(null)
    if (imageInputRef.current) imageInputRef.current.value = ""
  }

  const createMessageObjectUrl = (blob: Blob) => {
    const url = URL.createObjectURL(blob)
    messageObjectUrlsRef.current.add(url)
    return url
  }

  const handleCancelRequest = useCallback(() => {
    activeRequestControllerRef.current?.abort()
  }, [])

  const handleSendMessage = async () => {
    // If recording, stop it and flag to send immediately after
    if (isRecording) {
      shouldSendAfterStop.current = true
      stopRecording()
      return
    }

    if ((!input.trim() && !mediaBlob && !selectedImage) || isSubmitting) return

    setIsSubmitting(true)

    const requestId = createChatRequestId()
    const abortController = new AbortController()
    activeRequestControllerRef.current = abortController
    const requestType: ChatRequestKind = mediaBlob ? "voice" : selectedImage ? "image" : "chat"
    const hasAttachment = Boolean(mediaBlob || selectedImage)
    const stagePlan = buildChatStagePlan({ type: requestType, hasAttachment })
    const startedAt = Date.now()

    setLoadingState({
      requestId,
      stagePlan,
      startedAt,
      elapsedMs: 0,
      type: requestType,
      hasAttachment,
    })

    // Build FormData for n8n/API
    const formData = new FormData()
    formData.append("sessionId", activeSessionId)
    formData.append("clientMessageId", requestId)
    // Pass User ID if available, otherwise backend might fail or fallback
    if (user?.id) formData.append("userId", user.id)

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

    const previousAgent0ContextId = sessionAgent0ContextIds[activeSessionId]
    if (previousAgent0ContextId) {
      formData.append("agent0_context_id", previousAgent0ContextId)
    }

    // Optimistic UI Update
    let fileUrl = undefined
    let fileType: "image" | "voice" | undefined = undefined

    if (mediaBlob) {
      fileUrl = createMessageObjectUrl(mediaBlob)
      fileType = "voice"
    } else if (selectedImage) {
      fileUrl = createMessageObjectUrl(selectedImage)
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
    clearMedia()

    try {
      // Use the n8n proxy route
      const response = await fetch("/api/chat/n8n", {
        method: "POST",
        body: formData, // fetch automatically sets Content-Type boundary
        signal: abortController.signal,
      })

      if (!response.ok) {
        let serverError = "Failed to send message"
        let serverRequestId = response.headers.get("x-chat-request-id") || requestId
        let serverStage: ChatStageKey = "failed"
        let serverRouteHint = "failed"

        try {
          const errorBody = await response.json()
          const errorMeta =
            typeof errorBody._meta === "object" && errorBody._meta !== null
              ? (errorBody._meta as Record<string, unknown>)
              : undefined

          serverError =
            errorBody.error ||
            errorBody.message ||
            errorBody.details ||
            serverError
          serverRequestId =
            (typeof errorMeta?.requestId === "string" && errorMeta.requestId) ||
            (typeof errorBody.requestId === "string" && errorBody.requestId) ||
            serverRequestId
          serverStage =
            (typeof errorMeta?.stage === "string" && errorMeta.stage) ||
            (typeof errorBody.stage === "string" && errorBody.stage) ||
            serverStage
          serverRouteHint =
            (typeof errorMeta?.routeHint === "string" && errorMeta.routeHint) ||
            (typeof errorBody.routeHint === "string" && errorBody.routeHint) ||
            serverRouteHint
        } catch {
          // ignore parse failure, keep default fallback
        }

        throw {
          message: serverError,
          requestId: serverRequestId,
          stage: serverStage,
          routeHint: serverRouteHint,
        }
      }

      const data = await response.json()
      const meta = typeof data._meta === "object" && data._meta !== null
        ? (data._meta as Record<string, unknown>)
        : undefined

      // Handle response - assume standard output structure
      const aiContent =
        data.output ||
        data.text ||
        data.message ||
        data.description ||
        data.answer ||
        JSON.stringify(data)
      const durationMs =
        typeof meta?.durationMs === "number"
          ? meta.durationMs
          : Date.now() - startedAt
      const responseRequestId =
        (typeof meta?.requestId === "string" && meta.requestId) ||
        response.headers.get("x-chat-request-id") ||
        requestId
      const routeHint =
        (typeof meta?.routeHint === "string" && meta.routeHint) ||
        response.headers.get("x-chat-route-hint") ||
        inferRouteHint(data, { type: requestType, hasAttachment })
      const responseAgent0ContextId =
        typeof meta?.agent0ContextId === "string" && meta.agent0ContextId
          ? meta.agent0ContextId
          : undefined
      const webSearchUsed =
        typeof meta?.webSearchUsed === "boolean" ? meta.webSearchUsed : undefined
      const webSearchProvider =
        typeof meta?.webSearchProvider === "string" ? meta.webSearchProvider : undefined
      const webSearchPendingPrompt =
        typeof meta?.webSearchPendingPrompt === "string" ? meta.webSearchPendingPrompt : undefined
      const degradedFrom =
        typeof meta?.degradedFrom === "string" ? meta.degradedFrom : undefined
      const verificationStatus =
        isVerificationStatus(data.verificationStatus)
          ? data.verificationStatus
          : isVerificationStatus(meta?.verificationStatus)
            ? meta.verificationStatus
            : undefined
      const evidence = sanitizeEvidence(data.evidence) || sanitizeEvidence(meta?.evidence)
      const missingData = Array.isArray(data.missingData)
        ? (data.missingData as MissingDataItem[])
        : Array.isArray(meta?.missingData)
          ? (meta.missingData as MissingDataItem[])
          : undefined
      const warnings = Array.isArray(data.warnings)
        ? (data.warnings as unknown[]).filter((warning: unknown): warning is string => typeof warning === "string")
        : Array.isArray(meta?.warnings)
          ? (meta.warnings as unknown[]).filter((warning: unknown): warning is string => typeof warning === "string")
          : undefined
      const executionTrace = Array.isArray(data.executionTrace)
        ? (data.executionTrace as ExecutionTraceEvent[])
        : Array.isArray(meta?.executionTrace)
          ? (meta.executionTrace as ExecutionTraceEvent[])
          : undefined

      if (routeHint === "duplicate_inflight" || routeHint === "duplicate_replay") {
        await refreshMessages()
        if (onMessageSent) onMessageSent()
        return
      }

      if (responseAgent0ContextId) {
        persistAgent0ContextId(activeSessionId, responseAgent0ContextId)
      }

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: aiContent,
        timestamp: new Date(),
        citations: data.citations || [],
        requestMeta: {
          requestId: responseRequestId,
          durationMs,
          routeHint,
          stage: "completed",
          agent0ContextId: responseAgent0ContextId,
          webSearchUsed,
          webSearchProvider,
          webSearchPendingPrompt,
          degradedFrom,
          verificationStatus,
          evidence,
          missingData,
          warnings,
          executionTrace,
        },
      }

      setMessages((prev) => [...prev, assistantMessage])
      recordClientChatMetric({
        requestId: responseRequestId,
        sessionId: activeSessionId,
        type: requestType,
        hasAttachment,
        latencyMs: durationMs,
        routeHint,
        outcome: "ok",
        stage: "completed",
        timestamp: new Date().toISOString(),
      } satisfies ChatRequestMetric)

      // Notify parent to refresh session list (e.g. title might change)
      if (onMessageSent) onMessageSent()

    } catch (error) {
      console.error("Chat error:", error)
      const isAbortError = error instanceof DOMException && error.name === "AbortError"
      const message =
        isAbortError
          ? "Đã hủy yêu cầu. Bạn có thể chỉnh lại câu hỏi hoặc gửi câu khác."
          : typeof error === "object" &&
        error !== null &&
        "message" in error &&
        typeof error.message === "string"
          ? error.message
          : "Xin lỗi, tôi gặp lỗi khi xử lý yêu cầu. Vui lòng thử lại."
      const failedRequestId =
        typeof error === "object" &&
        error !== null &&
        "requestId" in error &&
        typeof error.requestId === "string"
          ? error.requestId
          : requestId
      const failedStage =
        isAbortError
          ? "failed"
          : typeof error === "object" &&
        error !== null &&
        "stage" in error &&
        typeof error.stage === "string"
          ? (error.stage as ChatStageKey)
          : "failed"
      const failedRouteHint =
        isAbortError
          ? "cancelled"
          : typeof error === "object" &&
        error !== null &&
        "routeHint" in error &&
        typeof error.routeHint === "string"
          ? error.routeHint
          : "failed"

      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: `${message}\n\nMã yêu cầu: \`${failedRequestId}\``,
        timestamp: new Date(),
        requestMeta: {
          requestId: failedRequestId,
          durationMs: Date.now() - startedAt,
          routeHint: failedRouteHint,
          stage: failedStage,
        },
      }
      setMessages((prev) => [...prev, errorMessage])
      recordClientChatMetric({
        requestId: failedRequestId,
        sessionId: activeSessionId,
        type: requestType,
        hasAttachment,
        latencyMs: Date.now() - startedAt,
        routeHint: failedRouteHint,
        outcome: "error",
        stage: failedStage,
        timestamp: new Date().toISOString(),
      } satisfies ChatRequestMetric)
    } finally {
      if (activeRequestControllerRef.current === abortController) {
        activeRequestControllerRef.current = null
      }
      setIsSubmitting(false)
      setLoadingState(null)
    }
  }

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedImage(e.target.files[0])
      clearRecording()
    }
  }

  // Effect to handle "Send to Stop" logic
  const submitAfterRecordingStops = useEffectEvent(() => {
    handleSendMessage()
  })

  useEffect(() => {
    if (mediaBlob && shouldSendAfterStop.current) {
      shouldSendAfterStop.current = false
      submitAfterRecordingStops()
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
                <span className="text-[10px] md:text-xs text-muted-foreground/50 truncate max-w-[200px] md:max-w-none">
                  Phiên trò chuyện đang hoạt động
                </span>
                <div className={`w-2 h-2 rounded-full shrink-0 ${(isHistoryLoading || isSubmitting) ? "bg-yellow-400 animate-pulse" : "bg-green-400"}`} />
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
              {loadingState && (
                <div className="flex justify-start px-4">
                  <div className="max-w-[90%] lg:max-w-[80%]">
                    <ChatRequestStatus
                      activeStage={resolveActiveStage(loadingState)}
                      stagePlan={loadingState.stagePlan}
                      elapsedMs={loadingState.elapsedMs}
                      requestId={loadingState.requestId}
                      onCancel={handleCancelRequest}
                    />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {telemetryEnabled && (
          <div className="border-t border-border bg-background/60 px-3 py-3 md:px-6">
            <ChatTelemetryPanel sessionId={activeSessionId} />
          </div>
        )}

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
                      {voicePreviewUrl && <audio controls src={voicePreviewUrl} className="w-full h-8" />}
                    </div>
                  </div>
                )}
                {selectedImage && selectedImagePreviewUrl && (
                  <div className="flex items-center gap-3">
                    <div className="relative w-16 h-16 rounded overflow-hidden border border-border">
                      <Image
                        src={selectedImagePreviewUrl}
                        alt="Preview"
                        fill
                        unoptimized
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
              disabled={isSubmitting || isRecording}
            />
            <Button
              onClick={isSubmitting ? handleCancelRequest : handleSendMessage}
              disabled={!isSubmitting && (!input.trim() && !mediaBlob && !selectedImage && !isRecording)}
              className={`${isSubmitting ? "bg-destructive hover:bg-destructive/90" : "bg-primary hover:bg-primary/90"} min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 px-3 md:px-4`}
            >
              {isSubmitting ? <X className="w-5 h-5" /> : <Send className="w-5 h-5" />}
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

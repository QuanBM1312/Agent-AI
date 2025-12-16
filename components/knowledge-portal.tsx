"use client"

import { useState, useRef, useEffect } from "react"
import { Upload, File, FileText, Sheet as Sheet3, Trash2, Plus, Loader2, Globe, Link as LinkIcon, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { MobileMenuButton } from "@/components/mobile-menu-button"

interface KnowledgeItem {
  id: string
  name: string
  type: "pdf" | "word" | "excel" | "sheet"
  size: string
  uploadedAt: string
}

interface SourceItem {
  id: string
  name: string
  type: "GOOGLE_SHEET" | "WEB_URL"
  status: string
}

export function KnowledgePortal() {
  const [isUploading, setIsUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [items, setItems] = useState<KnowledgeItem[]>([])

  const [sources, setSources] = useState<SourceItem[]>([])
  const [isAddingSource, setIsAddingSource] = useState(false)
  const [newSourceUrl, setNewSourceUrl] = useState("")
  const [isAddingSourceLoading, setIsAddingSourceLoading] = useState(false)

  const getFileType = (fileName: string): KnowledgeItem['type'] => {
    const ext = fileName.split('.').pop()?.toLowerCase()
    if (ext === 'pdf') return 'pdf'
    if (['xls', 'xlsx', 'csv'].includes(ext || '')) return 'excel'
    if (['doc', 'docx'].includes(ext || '')) return 'word'
    return 'pdf' // Default fallback
  }

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    try {
      const response = await fetch("/api/knowledge/sources")
      if (response.ok) {
        const data = await response.json()

        const validSources: SourceItem[] = []
        const validItems: KnowledgeItem[] = []

        data.forEach((item: any) => {
          // Identify type based on sheet_name or logic
          // Current logic: if sheet_name is 'WEB_URL' -> Source. Else -> File.
          if (item.sheet_name === 'WEB_URL' || item.sheet_name === 'GOOGLE_SHEET') {
            validSources.push({
              id: item.id,
              name: item.drive_name || item.drive_file_id,
              type: item.sheet_name === 'GOOGLE_SHEET' ? 'GOOGLE_SHEET' : 'WEB_URL',
              status: "Đang đồng bộ"
            })
          } else {
            validItems.push({
              id: item.id,
              name: item.drive_name || "Unknown File",
              type: getFileType(item.drive_name || ""),
              size: formatFileSize(Number(item.hash) || 0), // storing size in hash
              uploadedAt: item.created_at ? new Date(item.created_at).toISOString().split('T')[0] : ""
            })
          }
        })
        setSources(validSources)
        setItems(validItems)
      }
    } catch (error) {
      console.error("Failed to fetch knowledge sources:", error)
    }
  }

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
  }

  const handleUpload = async (file: File) => {
    setIsUploading(true)
    const formData = new FormData()
    formData.append("file", file)

    try {
      const response = await fetch("/api/knowledge/upload", {
        method: "POST",
        body: formData,
      })

      if (!response.ok) {
        const errorText = await response.text()
        try {
          const errorData = JSON.parse(errorText)
          throw new Error(errorData.error || "Upload failed")
        } catch (e: any) {
          // If JSON parse failed, it's likely an HTML error page or empty
          if (e.message !== "Upload failed" && !errorText.trim().startsWith("{")) {
            throw new Error(`Server Error ${response.status}: ${errorText.slice(0, 50)}`)
          }
          throw e
        }
      }

      const data = await response.json()

      const newItem: KnowledgeItem = {
        id: data.fileId || Date.now().toString(), // Should ideally be DB UUID but using GDrive ID for now
        name: data.fileName || file.name,
        type: getFileType(file.name),
        size: formatFileSize(file.size), // Display size immediately
        uploadedAt: new Date().toISOString().split('T')[0],
      }

      setItems(prev => [newItem, ...prev])

      // Optionally re-fetch to get the DB ID if needed
      // await fetchData()
    } catch (error: any) {
      console.error("Error uploading file:", error)
      alert(`Có lỗi xảy ra: ${error.message}`)
    } finally {
      setIsUploading(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ""
      }
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      handleUpload(file)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const file = e.dataTransfer.files?.[0]
    if (file) {
      handleUpload(file)
    }
  }

  const triggerFileInput = () => {
    fileInputRef.current?.click()
  }

  const handleAddSource = async () => {
    if (!newSourceUrl) return

    setIsAddingSourceLoading(true)
    try {
      const response = await fetch("/api/knowledge/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_name: newSourceUrl,
          source_type: "WEB_URL",
          source_url: newSourceUrl,
          refresh_frequency: "daily"
        })
      })

      if (response.ok) {
        const data = await response.json()
        setSources(prev => [...prev, {
          id: data.id || Date.now().toString(),
          name: data.drive_name || newSourceUrl,
          type: "WEB_URL",
          status: "Đang đồng bộ"
        }])
        setNewSourceUrl("")
        setIsAddingSource(false)
      } else {
        throw new Error("Failed to add source")
      }
    } catch (error) {
      console.error("Error adding source:", error)
      alert("Không thể thêm nguồn dữ liệu. Vui lòng thử lại.")
    } finally {
      setIsAddingSourceLoading(false)
    }
  }

  const getFileIcon = (type: string) => {
    switch (type) {
      case "pdf":
        return <FileText className="w-5 h-5 text-red-500" />
      case "excel":
        return <Sheet3 className="w-5 h-5 text-green-500" />
      case "word":
        return <File className="w-5 h-5 text-blue-500" />
      default:
        return <File className="w-5 h-5 text-gray-500" />
    }
  }

  const getSourceIcon = (type: string) => {
    switch (type) {
      case "GOOGLE_SHEET":
        return (
          <div className="w-10 h-10 rounded bg-blue-100 flex items-center justify-center">
            <span className="text-blue-600 font-bold text-sm">GS</span>
          </div>
        )
      case "WEB_URL":
        return (
          <div className="w-10 h-10 rounded bg-indigo-100 flex items-center justify-center">
            <Globe className="w-5 h-5 text-indigo-600" />
          </div>
        )
      default:
        return (
          <div className="w-10 h-10 rounded bg-gray-100 flex items-center justify-center">
            <LinkIcon className="w-5 h-5 text-gray-600" />
          </div>
        )
    }
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="border-b border-border p-3 md:p-6">
        <div className="flex items-start gap-3">
          <MobileMenuButton className="-ml-1 mt-0.5" />

          <div className="flex-1 min-w-0">
            <h2 className="text-xl md:text-2xl font-bold text-foreground">Cổng Nạp Tri thức</h2>
            <p className="text-xs md:text-sm text-muted-foreground mt-1">Quản lý các tài liệu và nguồn dữ liệu của công ty</p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {/* Upload Area */}
        <div
          onClick={triggerFileInput}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          className={`mb-8 border-2 border-dashed border-border rounded-lg p-8 text-center hover:border-primary transition-colors cursor-pointer ${isUploading ? 'opacity-50 pointer-events-none' : ''}`}
        >
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            onChange={handleFileSelect}
            accept=".pdf,.doc,.docx,.xls,.xlsx,.csv"
          />
          {isUploading ? (
            <div className="flex flex-col items-center">
              <Loader2 className="w-12 h-12 text-primary animate-spin mb-3" />
              <h3 className="font-semibold text-foreground mb-1">Đang tải lên...</h3>
              <p className="text-sm text-muted-foreground">Vui lòng đợi trong giây lát</p>
            </div>
          ) : (
            <>
              <Upload className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
              <h3 className="font-semibold text-foreground mb-1">Kéo thả tài liệu hoặc nhấp để chọn</h3>
              <p className="text-sm text-muted-foreground">Hỗ trợ: PDF, Word, Excel, Google Sheets</p>
            </>
          )}
        </div>

        {/* Connected Sources */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-foreground">Nguồn dữ liệu kết nối</h3>
            {!isAddingSource && (
              <Button variant="outline" size="sm" className="gap-2" onClick={() => setIsAddingSource(true)}>
                <Plus className="w-4 h-4" />
                Thêm nguồn
              </Button>
            )}
          </div>

          {isAddingSource && (
            <div className="mb-4 p-4 bg-card border border-border rounded-lg animate-in fade-in slide-in-from-top-2">
              <div className="flex gap-2">
                <Input
                  placeholder="Nhập URL trang web hoặc tài liệu..."
                  value={newSourceUrl}
                  onChange={(e) => setNewSourceUrl(e.target.value)}
                  className="flex-1"
                />
                <Button onClick={handleAddSource} disabled={isAddingSourceLoading}>
                  {isAddingSourceLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Thêm"}
                </Button>
                <Button variant="ghost" size="icon" onClick={() => setIsAddingSource(false)}>
                  <X className="w-4 h-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-2">Hỗ trợ: Website URL, Google Docs, Notion Public Link</p>
            </div>
          )}

          <div className="space-y-3">
            {sources.map((source) => (
              <div key={source.id} className="flex items-center justify-between p-4 bg-card border border-border rounded-lg">
                <div className="flex items-center gap-3 overflow-hidden">
                  {getSourceIcon(source.type)}
                  <div className="min-w-0">
                    <p className="font-medium text-foreground truncate">{source.name}</p>
                    <p className="text-xs text-muted-foreground">{source.status}</p>
                  </div>
                </div>
                <Button variant="outline" size="sm" className="shrink-0 ml-2">
                  Cập nhật
                </Button>
              </div>
            ))}
          </div>
        </div>

        {/* Uploaded Files */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-foreground">Tài liệu đã tải lên</h3>
            <Button size="sm" className="gap-2">
              <Plus className="w-4 h-4" />
              Thêm tài liệu
            </Button>
          </div>
          <div className="space-y-2">
            {items.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between p-4 bg-card border border-border rounded-lg hover:border-primary transition-colors"
              >
                <div className="flex items-center gap-3 flex-1">
                  {getFileIcon(item.type)}
                  <div className="flex-1">
                    <p className="font-medium text-foreground text-sm">{item.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.size} • Tải lên {item.uploadedAt}
                    </p>
                  </div>
                </div>
                <button className="p-2 hover:bg-muted rounded transition-colors">
                  <Trash2 className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

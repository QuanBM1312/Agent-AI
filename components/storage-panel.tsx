"use client"

import { useState } from "react"
import { ImageIcon, MessageCircle, FileText, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { MobileMenuButton } from "@/components/mobile-menu-button"

interface StorageItem {
  id: string
  type: "image" | "voice" | "text"
  content: string
  date: string
  context: string
}

export function StoragePanel() {
  const [items, setItems] = useState<StorageItem[]>([
    {
      id: "1",
      type: "image",
      content: "Hình ảnh máy lạnh bị hỏng",
      date: "2024-10-24",
      context: "Công việc #123 - Khách hàng ABC",
    },
    {
      id: "2",
      type: "voice",
      content: "Báo cáo công việc hôm nay",
      date: "2024-10-24",
      context: "Kỹ thuật viên Minh",
    },
    {
      id: "3",
      type: "text",
      content: "Hoàn thành bảo dưỡng định kỳ, thay dầu, kiểm tra...",
      date: "2024-10-23",
      context: "Công việc #122",
    },
  ])

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "image":
        return <ImageIcon className="w-5 h-5 text-blue-500" />
      case "voice":
        return <MessageCircle className="w-5 h-5 text-green-500" />
      case "text":
        return <FileText className="w-5 h-5 text-purple-500" />
      default:
        return null
    }
  }

  const getTypeLabel = (type: string) => {
    switch (type) {
      case "image":
        return "Hình ảnh"
      case "voice":
        return "Tin nhắn thoại"
      case "text":
        return "Văn bản"
      default:
        return type
    }
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="border-b border-border p-3 md:p-6">
        <div className="flex items-start gap-3">
          <MobileMenuButton className="-ml-1 mt-0.5" />

          <div className="flex-1 min-w-0 flex items-center justify-between">
            <div>
              <h2 className="text-xl md:text-2xl font-bold text-foreground">Lưu trữ Đa phương thức</h2>
              <p className="text-xs md:text-sm text-muted-foreground mt-1">
                Quản lý hình ảnh, tin nhắn thoại, và báo cáo theo ngữ cảnh
              </p>
            </div>
            <Button className="gap-2 shrink-0 ml-2">
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">Thêm</span>
            </Button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="space-y-3">
          {items.map((item) => (
            <div
              key={item.id}
              className="p-4 bg-card border border-border rounded-lg hover:border-primary transition-colors"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  {getTypeIcon(item.type)}
                  <div>
                    <p className="font-medium text-foreground">{item.content}</p>
                    <p className="text-xs text-muted-foreground mt-1">{getTypeLabel(item.type)}</p>
                  </div>
                </div>
                <button className="p-2 hover:bg-muted rounded transition-colors">
                  <Trash2 className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{item.context}</span>
                <span>{item.date}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

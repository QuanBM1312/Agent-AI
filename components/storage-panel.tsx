"use client"

import { useState, useEffect } from "react"
import { Search, Loader2, Package, Archive, AlertCircle } from "lucide-react"
import { Input } from "@/components/ui/input"
import { MobileMenuButton } from "@/components/mobile-menu-button"

interface InventoryItem {
  id: string
  item_code: string
  name: string
  unit: string
  quantity: number
  details: {
    opening: number
    in: number
    out: number
  }
}

export function StoragePanel() {
  const [items, setItems] = useState<InventoryItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")

  const fetchInventory = async () => {
    setIsLoading(true)
    try {
      const params = new URLSearchParams()
      if (searchQuery) params.append("search", searchQuery)

      const res = await fetch(`/api/inventory?${params.toString()}`)
      if (res.ok) {
        const data = await res.json()
        setItems(data.data || [])
      }
    } catch (error) {
      console.error("Failed to fetch inventory", error)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    // Debounce search
    const timer = setTimeout(() => {
      fetchInventory()
    }, 500)
    return () => clearTimeout(timer)
  }, [searchQuery])

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="border-b border-border p-3 md:p-6">
        <div className="flex items-start gap-3">
          <MobileMenuButton className="-ml-1 mt-0.5" />

          <div className="flex-1 min-w-0">
            <h2 className="text-xl md:text-2xl font-bold text-foreground flex items-center gap-2">
              <Package className="w-6 h-6 text-primary" />
              Quản lý Tồn kho
            </h2>
            <p className="text-xs md:text-sm text-muted-foreground mt-1">
              Theo dõi biến động tồn kho thực tế theo thời gian thực
            </p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden flex flex-col p-4 md:p-6">
        {/* Search */}
        <div className="mb-4 relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Tìm kiếm theo mã, tên vật tư..."
            className="pl-9"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto border rounded-md bg-card shadow-sm">
          <table className="w-full text-sm text-left">
            <thead className="bg-muted text-muted-foreground font-medium sticky top-0 z-10">
              <tr>
                <th className="p-3 w-32">Mã SP</th>
                <th className="p-3">Tên sản phẩm / Model</th>
                <th className="p-3 w-24 text-center">Đơn vị</th>
                <th className="p-3 w-32 text-right">Tồn kho</th>
                <th className="p-3 w-40 text-right hidden lg:table-cell text-muted-foreground/70 font-normal">Đầu kỳ</th>
                <th className="p-3 w-40 text-right hidden lg:table-cell text-green-600/70 font-normal">Nhập</th>
                <th className="p-3 w-40 text-right hidden lg:table-cell text-red-600/70 font-normal">Xuất</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="p-10 text-center text-muted-foreground">
                    <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3 text-primary/50" />
                    Đang tải dữ liệu tồn kho...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-10 text-center text-muted-foreground flex flex-col items-center">
                    <Archive className="w-10 h-10 mb-2 opacity-20" />
                    <p>Không tìm thấy sản phẩm nào trong kho.</p>
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id} className="hover:bg-muted/50 transition-colors group">
                    <td className="p-3 font-medium text-primary">{item.item_code}</td>
                    <td className="p-3 font-medium">{item.name}</td>
                    <td className="p-3 text-center text-muted-foreground">{item.unit}</td>
                    <td className={`p-3 text-right font-bold ${item.quantity <= 5 ? 'text-red-500' : 'text-foreground'}`}>
                      {item.quantity}
                      {item.quantity <= 5 && (
                        <AlertCircle className="w-3 h-3 inline-block ml-1 -mt-0.5 text-red-500" />
                      )}
                    </td>
                    {/* Details columns for large screens */}
                    <td className="p-3 text-right hidden lg:table-cell text-muted-foreground">{item.details.opening}</td>
                    <td className="p-3 text-right hidden lg:table-cell text-green-600">+{item.details.in}</td>
                    <td className="p-3 text-right hidden lg:table-cell text-red-600">-{item.details.out}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

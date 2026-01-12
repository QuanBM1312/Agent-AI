"use client"

import { useState, useEffect } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Loader2 } from "lucide-react"

interface InventoryDialogProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  item?: {
    id: string
    item_code: string
    name: string
    unit: string
    initial_opening: number
    total_in: number
    total_out: number
  }
}

export function InventoryDialog({ isOpen, onClose, onSuccess, item }: InventoryDialogProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [formData, setFormData] = useState({
    product_code: "",
    model_name: "",
    unit: "",
    opening_qty: 0,
    total_in: 0,
    total_out: 0,
  })

  useEffect(() => {
    if (item) {
      setFormData({
        product_code: item.item_code,
        model_name: item.name,
        unit: item.unit,
        opening_qty: item.initial_opening || 0,
        total_in: item.total_in || 0,
        total_out: item.total_out || 0,
      })
    } else {
      setFormData({
        product_code: "",
        model_name: "",
        unit: "",
        opening_qty: 0,
        total_in: 0,
        total_out: 0,
      })
    }
  }, [item, isOpen])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError(null)

    try {
      const url = "/api/inventory"
      const method = item ? "PUT" : "POST"
      const body = item
        ? { product_id: item.id, ...formData }
        : formData

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      if (res.ok) {
        onSuccess()
        onClose()
      } else {
        const data = await res.json()
        setError(data.error || "Có lỗi xảy ra")
      }
    } catch (err) {
      setError("Không thể kết nối với máy chủ")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{item ? "Chỉnh sửa vật tư" : "Thêm vật tư mới"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="product_code">Mã vật tư</Label>
              <Input
                id="product_code"
                value={formData.product_code}
                onChange={(e) => setFormData({ ...formData, product_code: e.target.value })}
                placeholder="VD: DH-001"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="unit">Đơn vị</Label>
              <Input
                id="unit"
                value={formData.unit}
                onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                placeholder="VD: Bộ, Mét..."
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="model_name">Tên sản phẩm / Model</Label>
            <Input
              id="model_name"
              value={formData.model_name}
              onChange={(e) => setFormData({ ...formData, model_name: e.target.value })}
              placeholder="VD: Daikin Inverter 1HP"
              required
            />
          </div>

          <div className="border-t pt-4 mt-2">
            <h4 className="text-sm font-semibold mb-3">Số liệu tháng hiện tại</h4>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="opening_qty">Tồn kho đầu kỳ</Label>
                <Input
                  id="opening_qty"
                  type="number"
                  value={formData.opening_qty}
                  onChange={(e) => setFormData({ ...formData, opening_qty: Number(e.target.value) })}
                  min="0"
                />
              </div>

              {item && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="total_in" className="text-green-600">Tổng Nhập</Label>
                    <Input
                      id="total_in"
                      type="number"
                      value={formData.total_in}
                      onChange={(e) => setFormData({ ...formData, total_in: Number(e.target.value) })}
                      min="0"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="total_out" className="text-red-600">Tổng Xuất</Label>
                    <Input
                      id="total_out"
                      type="number"
                      value={formData.total_out}
                      onChange={(e) => setFormData({ ...formData, total_out: Number(e.target.value) })}
                      min="0"
                    />
                  </div>
                </div>
              )}
            </div>

            <p className="text-[10px] text-muted-foreground italic mt-3">
              * Thay đổi các số liệu này sẽ trực tiếp cập nhật tổng tồn kho thực tế.
            </p>
          </div>

          {error && <p className="text-sm text-red-500 font-medium">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>
              Hủy
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {item ? "Cập nhật" : "Lưu"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

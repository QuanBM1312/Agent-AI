"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Plus, Trash2, Package, Hash, Loader2, Users } from "lucide-react"

interface ProjectFormProps {
  customerId: string
  initialData?: any // Added for editing
  onSuccess: () => void
}

interface ItemForm {
  model_name: string
  quantity: number
  warranty_start_date: string
  warranty_end_date: string
  serials: string[]
}

export function ProjectForm({ customerId, initialData, onSuccess }: ProjectFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [allUsers, setAllUsers] = useState<any[]>([])
  const [selectedPersonnel, setSelectedPersonnel] = useState<string[]>(
    initialData?.project_personnel?.map((p: any) => p.user_id) || []
  )
  const [projectData, setProjectData] = useState({
    name: initialData?.name || "",
    address: initialData?.address || "",
    contact_person: initialData?.contact_person || "",
    contact_position: initialData?.contact_position || "",
    input_contract_no: initialData?.input_contract_no || "",
    input_contract_date: initialData?.input_contract_date ? new Date(initialData.input_contract_date).toISOString().split('T')[0] : "",
    output_contract_no: initialData?.output_contract_no || "",
    output_contract_date: initialData?.output_contract_date ? new Date(initialData.output_contract_date).toISOString().split('T')[0] : ""
  })

  const [items, setItems] = useState<ItemForm[]>(
    initialData?.project_items?.map((item: any) => ({
      model_name: item.model_name,
      quantity: item.quantity,
      warranty_start_date: item.warranty_start_date ? new Date(item.warranty_start_date).toISOString().split('T')[0] : "",
      warranty_end_date: item.warranty_end_date ? new Date(item.warranty_end_date).toISOString().split('T')[0] : "",
      serials: item.project_serials?.map((s: any) => s.serial_number) || [""]
    })) || [
      { model_name: "", quantity: 1, warranty_start_date: "", warranty_end_date: "", serials: [""] }
    ]
  )

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const res = await fetch("/api/users?limit=100")
        if (res.ok) {
          const data = await res.json()
          setAllUsers(data.data || [])
        }
      } catch (error) {
        console.error("Failed to fetch users", error)
      }
    }
    fetchUsers()
  }, [])

  const addItem = () => {
    setItems([...items, { model_name: "", quantity: 1, warranty_start_date: "", warranty_end_date: "", serials: [""] }])
  }

  const removeItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index))
  }

  const updateItem = (index: number, field: keyof ItemForm, value: any) => {
    const newItems = [...items]
    newItems[index] = { ...newItems[index], [field]: value }
    setItems(newItems)
  }

  const addSerial = (itemIndex: number) => {
    const newItems = [...items]
    newItems[itemIndex].serials.push("")
    newItems[itemIndex].quantity = newItems[itemIndex].serials.length
    setItems(newItems)
  }

  const removeSerial = (itemIndex: number, serialIndex: number) => {
    const newItems = [...items]
    newItems[itemIndex].serials = newItems[itemIndex].serials.filter((_, i) => i !== serialIndex)
    newItems[itemIndex].quantity = newItems[itemIndex].serials.length
    setItems(newItems)
  }

  const updateSerial = (itemIndex: number, serialIndex: number, value: string) => {
    const newItems = [...items]
    newItems[itemIndex].serials[serialIndex] = value
    setItems(newItems)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!projectData.name) {
      alert("Vui lòng nhập tên dự án")
      return
    }

    setIsSubmitting(true)
    try {
      const method = initialData ? "PATCH" : "POST"
      const payload = {
        customer_id: customerId,
        ...(initialData ? { id: initialData.id } : {}),
        ...projectData,
        items: items.map(item => ({
          ...item,
          serials: item.serials.filter(s => s.trim() !== "")
        })),
        personnel_ids: selectedPersonnel
      }

      const res = await fetch("/api/projects", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      })

      if (res.ok) {
        onSuccess()
      } else {
        const err = await res.json()
        alert(`Lỗi: ${err.error}`)
      }
    } catch (error) {
      alert("Không thể " + (initialData ? "cập nhật" : "tạo") + " dự án")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Project Basic Info */}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Tên dự án <span className="text-red-500">*</span></label>
          <Input
            placeholder="Nhập tên dự án..."
            value={projectData.name}
            onChange={e => setProjectData({ ...projectData, name: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Địa chỉ dự án</label>
          <Input
            placeholder="Địa điểm triển khai..."
            value={projectData.address}
            onChange={e => setProjectData({ ...projectData, address: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Người liên hệ bên dự án</label>
          <Input
            placeholder="Tên người đại diện..."
            value={projectData.contact_person}
            onChange={e => setProjectData({ ...projectData, contact_person: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Vị trí công việc</label>
          <Input
            placeholder="VD: Chỉ huy trưởng..."
            value={projectData.contact_position}
            onChange={e => setProjectData({ ...projectData, contact_position: e.target.value })}
          />
        </div>
      </div>

      {/* Contract Info */}
      <div className="grid md:grid-cols-2 gap-6 bg-muted/20 p-4 rounded-lg border">
        <div className="space-y-3">
          <h4 className="text-xs font-bold text-muted-foreground uppercase uppercase">Hợp đồng đầu vào</h4>
          <div className="grid grid-cols-2 gap-2">
            <Input
              placeholder="Số hợp đồng..."
              className="text-xs"
              value={projectData.input_contract_no}
              onChange={e => setProjectData({ ...projectData, input_contract_no: e.target.value })}
            />
            <Input
              type="date"
              className="text-xs"
              value={projectData.input_contract_date}
              onChange={e => setProjectData({ ...projectData, input_contract_date: e.target.value })}
            />
          </div>
        </div>
        <div className="space-y-3">
          <h4 className="text-xs font-bold text-muted-foreground uppercase">Hợp đồng đầu ra</h4>
          <div className="grid grid-cols-2 gap-2">
            <Input
              placeholder="Số hợp đồng..."
              className="text-xs"
              value={projectData.output_contract_no}
              onChange={e => setProjectData({ ...projectData, output_contract_no: e.target.value })}
            />
            <Input
              type="date"
              className="text-xs"
              value={projectData.output_contract_date}
              onChange={e => setProjectData({ ...projectData, output_contract_date: e.target.value })}
            />
          </div>
        </div>
      </div>

      {/* Personnel Assignment */}
      <div className="space-y-3">
        <h4 className="text-sm font-semibold flex items-center gap-2">
          <Users className="w-4 h-4 text-primary" />
          Nhân sự thực hiện
        </h4>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
          {allUsers.map((user) => (
            <div
              key={user.id}
              className={`flex items-center gap-2 p-2 border rounded-md cursor-pointer transition-colors ${selectedPersonnel.includes(user.id)
                ? 'bg-primary/10 border-primary shadow-sm'
                : 'hover:bg-muted'
                }`}
              onClick={() => {
                if (selectedPersonnel.includes(user.id)) {
                  setSelectedPersonnel(selectedPersonnel.filter(id => id !== user.id))
                } else {
                  setSelectedPersonnel([...selectedPersonnel, user.id])
                }
              }}
            >
              <div className={`w-3 h-3 rounded-full ${selectedPersonnel.includes(user.id) ? 'bg-primary' : 'border border-muted-foreground'
                }`} />
              <div className="flex flex-col">
                <span className="text-xs font-medium">{user.full_name || user.email}</span>
                <span className="text-[10px] text-muted-foreground">{user.role}</span>
              </div>
            </div>
          ))}
          {allUsers.length === 0 && (
            <p className="text-xs text-muted-foreground italic">Đang tải danh sách nhân sự...</p>
          )}
        </div>
      </div>

      {/* Items & Serials */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold flex items-center gap-2">
            <Package className="w-4 h-4 text-primary" />
            Danh sách thiết bị
          </h4>
          <Button type="button" size="sm" variant="outline" onClick={addItem} className="h-8 gap-1">
            <Plus className="w-3.5 h-3.5" /> Thêm Model
          </Button>
        </div>

        <div className="space-y-6">
          {items.map((item, itemIdx) => (
            <div key={itemIdx} className="border rounded-lg p-4 space-y-4 relative bg-card shadow-sm">
              {items.length > 1 && (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="absolute top-2 right-2 text-red-500 h-8 w-8 hover:bg-red-50"
                  onClick={() => removeItem(itemIdx)}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              )}

              <div className="grid md:grid-cols-3 gap-3">
                <div className="space-y-1 md:col-span-1">
                  <label className="text-[10px] font-bold uppercase text-muted-foreground">Model thiết bị</label>
                  <Input
                    placeholder="Tên model..."
                    value={item.model_name}
                    onChange={e => updateItem(itemIdx, 'model_name', e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase text-muted-foreground">Ngày bắt đầu BH</label>
                  <Input
                    type="date"
                    value={item.warranty_start_date}
                    onChange={e => updateItem(itemIdx, 'warranty_start_date', e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase text-muted-foreground">Ngày hết hạn BH</label>
                  <Input
                    type="date"
                    value={item.warranty_end_date}
                    onChange={e => updateItem(itemIdx, 'warranty_end_date', e.target.value)}
                  />
                </div>
              </div>

              {/* Serial Numbers */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-bold uppercase text-muted-foreground flex items-center gap-1">
                    <Hash className="w-3 h-3" />
                    Danh sách số Serial ({item.serials.length})
                  </label>
                  <Button type="button" size="sm" variant="ghost" onClick={() => addSerial(itemIdx)} className="h-6 text-[10px] gap-1 px-2">
                    <Plus className="w-3 h-3" /> Thêm Serial
                  </Button>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-2">
                  {item.serials.map((sn, snIdx) => (
                    <div key={snIdx} className="relative group">
                      <Input
                        placeholder={`SN ${snIdx + 1}`}
                        className="text-xs h-8 pr-7"
                        value={sn}
                        onChange={e => updateSerial(itemIdx, snIdx, e.target.value)}
                      />
                      {item.serials.length > 1 && (
                        <button
                          type="button"
                          className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={() => removeSerial(itemIdx, snIdx)}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="pt-4 border-t flex justify-end gap-3">
        <Button type="submit" className="w-full md:w-32" disabled={isSubmitting}>
          {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Lưu dự án"}
        </Button>
      </div>
    </form>
  )
}

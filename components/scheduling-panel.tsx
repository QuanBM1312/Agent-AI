"use client"

import { useState, useEffect } from "react"
import { Calendar, Clock, Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { MobileMenuButton } from "@/components/mobile-menu-button"



interface SchedulingPanelProps {
  userRole: string
}

interface Job {
  id: string
  job_code: string
  job_type: string
  scheduled_start_time: string | null
  scheduled_end_time: string | null
  status: string
  customers: {
    company_name: string
  }
  users_jobs_assigned_technician_idTousers?: {
    full_name: string
  }
}

export function SchedulingPanel({ userRole }: SchedulingPanelProps) {
  const [jobs, setJobs] = useState<Job[]>([])
  const [technicians, setTechnicians] = useState<{ id: string, full_name: string }[]>([])
  const [customers, setCustomers] = useState<{ id: string, company_name: string }[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Form State
  const [newItem, setNewItem] = useState({
    job_code: '',
    job_type: 'Lắp đặt mới',
    start_date: '',
    start_time: '',
    customer_id: '',
    technician_id: '',
    notes: ''
  })

  // Check permissions
  const canCreateJob = ["Admin", "Manager"].includes(userRole)

  const fetchJobs = async () => {
    setIsLoading(true)
    try {
      const res = await fetch("/api/jobs")
      if (res.ok) {
        const data = await res.json()
        setJobs(data.jobs || [])
      }
    } catch (error) {
      console.error("Failed to fetch jobs", error)
    } finally {
      setIsLoading(false)
    }
  }

  // Fetch Technicians for dropdown
  const fetchTechnicians = async () => {
    try {
      const res = await fetch("/api/users?role=Technician")
      if (res.ok) {
        const data = await res.json()
        if (Array.isArray(data)) {
          setTechnicians(data)
        }
      }
    } catch (error) {
      console.error("Failed to fetch technicians", error)
    }
  }

  // Fetch Customers for dropdown
  const fetchCustomers = async () => {
    try {
      const res = await fetch("/api/customers")
      if (res.ok) {
        const data = await res.json()
        if (data.customers && Array.isArray(data.customers)) {
          setCustomers(data.customers)
        }
      }
    } catch (error) {
      console.error("Failed to fetch customers", error)
    }
  }

  useEffect(() => {
    fetchJobs()
    if (canCreateJob) {
      fetchTechnicians()
      fetchCustomers() // Fetch customers too
    }
  }, [userRole, canCreateJob])

  const handleSubmit = async () => {
    if (!newItem.job_code || !newItem.start_date || !newItem.technician_id || !newItem.customer_id) {
      alert("Vui lòng điền đầy đủ thông tin (Mã, Khách hàng, Ngày, Kỹ thuật viên)")
      return
    }

    setIsSubmitting(true)
    try {
      // Construct ISO Date
      const startDateTime = new Date(`${newItem.start_date}T${newItem.start_time || '09:00'}:00`).toISOString()

      // Fixed duration for demo (2 hours)
      const endDateTime = new Date(new Date(startDateTime).getTime() + 2 * 60 * 60 * 1000).toISOString()

      const payload = {
        job_code: newItem.job_code,
        customer_id: newItem.customer_id,
        job_type: newItem.job_type,
        scheduled_start_time: startDateTime,
        scheduled_end_time: endDateTime,
        notes: newItem.notes,
        assigned_technician_id: newItem.technician_id || undefined // Send directly for atomic creation
      }

      // 1. Create Job (Atomic with Assignment)
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || "Failed to create")
      }

      // No need for separate assign call anymore

      alert("Tạo công việc thành công!")
      setShowForm(false)
      setNewItem({
        job_code: '',
        job_type: 'Lắp đặt mới',
        start_date: '',
        start_time: '',
        customer_id: '',
        technician_id: '',
        notes: ''
      })
      fetchJobs()

    } catch (error: any) {
      alert(`Lỗi: ${error.message}`)
    } finally {
      setIsSubmitting(false)
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
              <h2 className="text-xl md:text-2xl font-bold text-foreground">Lịch hẹn</h2>
              <p className="text-xs md:text-sm text-muted-foreground mt-1">
                {userRole === 'Technician' ? 'Danh sách công việc được giao' : 'Quản lý lịch làm việc và phân công'}
              </p>
            </div>
            {canCreateJob && (
              <Button onClick={() => setShowForm(!showForm)} className="gap-2 shrink-0 ml-2">
                <Plus className="w-4 h-4" />
                <span className="hidden sm:inline">Tạo lịch hẹn</span>
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {showForm && canCreateJob && (
          <div className="mb-6 p-4 bg-card border border-border rounded-lg shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-foreground">Tạo lịch hẹn mới</h3>
              <button onClick={() => setShowForm(false)}>
                <X className="w-5 h-5 text-muted-foreground" />
              </button>
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium">Mã công việc</label>
                  <Input
                    placeholder="VD: JOB-001"
                    value={newItem.job_code}
                    onChange={(e) => setNewItem({ ...newItem, job_code: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium">Loại</label>
                  <select
                    className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
                    value={newItem.job_type}
                    onChange={(e) => setNewItem({ ...newItem, job_type: e.target.value })}
                  >
                    <option value="Lắp đặt mới">Lắp đặt mới</option>
                    <option value="Bảo hành">Bảo hành</option>
                    <option value="Sửa chữa">Sửa chữa</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium">Khách hàng</label>
                <select
                  className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
                  value={newItem.customer_id}
                  onChange={(e) => setNewItem({ ...newItem, customer_id: e.target.value })}
                >
                  <option value="">-- Chọn khách hàng --</option>
                  {customers.map(cust => (
                    <option key={cust.id} value={cust.id}>
                      {cust.company_name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Input
                  type="date"
                  value={newItem.start_date}
                  onChange={(e) => setNewItem({ ...newItem, start_date: e.target.value })}
                />
                <Input
                  type="time"
                  value={newItem.start_time}
                  onChange={(e) => setNewItem({ ...newItem, start_time: e.target.value })}
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium">Phân công kỹ thuật</label>
                <select
                  className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
                  value={newItem.technician_id}
                  onChange={(e) => setNewItem({ ...newItem, technician_id: e.target.value })}
                >
                  <option value="">-- Chọn kỹ thuật viên --</option>
                  {technicians.map(tech => (
                    <option key={tech.id} value={tech.id}>
                      {tech.full_name}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-muted-foreground">
                  * Chỉ hiển thị nhân viên trong Department của bạn
                </p>
              </div>

              <Input
                placeholder="Ghi chú (Tên khách, địa chỉ...)"
                value={newItem.notes}
                onChange={(e) => setNewItem({ ...newItem, notes: e.target.value })}
              />

              <div className="flex gap-2 pt-2">
                <Button className="flex-1" onClick={handleSubmit} disabled={isSubmitting}>
                  {isSubmitting ? "Đang tạo..." : "Tạo công việc"}
                </Button>
                <Button variant="outline" className="flex-1 bg-transparent" onClick={() => setShowForm(false)}>
                  Hủy
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Schedule List */}
        <div className="space-y-3">
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Đang tải dữ liệu...</div>
          ) : jobs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">Không có công việc nào</div>
          ) : (
            jobs.map((job) => {
              const startTime = job.scheduled_start_time ? new Date(job.scheduled_start_time) : null
              const dateStr = startTime ? startTime.toLocaleDateString('vi-VN') : 'Chưa xếp lịch'
              const timeStr = startTime ? startTime.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '--:--'

              return (
                <div
                  key={job.id}
                  className="p-4 bg-card border border-border rounded-lg hover:border-primary transition-colors"
                >
                  <div className="flex items-start justify-between mb-3">
                    <h3 className="font-semibold text-foreground">
                      [{job.job_code}] {job.job_type.replace(/_/g, ' ')}
                    </h3>
                    <span className={`px-2 py-1 text-xs rounded font-medium ${job.status === 'M_i' ? 'bg-blue-100 text-blue-700' :
                      job.status === 'Ho_n_th_nh' ? 'bg-green-100 text-green-700' :
                        'bg-slate-100 text-slate-700'
                      }`}>
                      {job.status === 'M_i' ? 'Mới' : job.status}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Calendar className="w-4 h-4" />
                      {dateStr}
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Clock className="w-4 h-4" />
                      {timeStr}
                    </div>
                    <div className="text-muted-foreground col-span-1 md:col-span-2">
                      <span className="font-medium text-foreground">Khách:</span> {job.customers?.company_name}
                    </div>
                    {/* Only show technician name if not strictly viewed by technician (implied context) or consistent UI */}
                    <div className="text-muted-foreground col-span-1 md:col-span-2">
                      <span className="font-medium text-foreground">KTV:</span> {job.users_jobs_assigned_technician_idTousers?.full_name || 'Chưa phân công'}
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}

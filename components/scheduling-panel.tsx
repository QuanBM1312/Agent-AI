"use client"

import { useState, useEffect } from "react"
import { Calendar as CalendarIcon, Clock, Plus, ChevronLeft, ChevronRight, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
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
  const [showCreateModal, setShowCreateModal] = useState(false)

  // Calendar State
  const [currentDate, setCurrentDate] = useState(new Date())

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
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Permissions
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

  // Fetch Dropdown Data
  useEffect(() => {
    fetchJobs()
    if (canCreateJob) {
      const fetchData = async () => {
        try {
          const [techRes, custRes] = await Promise.all([
            fetch("/api/users?role=Technician"),
            fetch("/api/customers")
          ])

          if (techRes.ok) {
            const techData = await techRes.json()
            if (Array.isArray(techData)) setTechnicians(techData)
          }

          if (custRes.ok) {
            const custData = await custRes.json()
            if (custData.customers && Array.isArray(custData.customers)) setCustomers(custData.customers)
          }
        } catch (error) {
          console.error("Failed to fetch dropdown data", error)
        }
      }
      fetchData()
    }
  }, [userRole, canCreateJob])

  // --- Calendar Logic ---

  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear()
    const month = date.getMonth()
    return new Date(year, month + 1, 0).getDate()
  }

  const getFirstDayOfMonth = (date: Date) => {
    const year = date.getFullYear()
    const month = date.getMonth()
    // 0 = Sunday, 1 = Monday, ...
    // We want Monday to be 0 for our grid if we start with Mon
    // JS: Sun=0, Mon=1. 
    // Let's stick to standard Sun=0 start for simplest grid, or adjust for Mon start.
    // Let's use Monday start to match typical business calendars in VN.
    const day = new Date(year, month, 1).getDay()
    // JS Day: 0(Sun), 1(Mon), 2(Tue)...
    // Mon Start: Mon(0), Tue(1)... Sun(6)
    // Map: 0->6, 1->0, 2->1 ... 
    return day === 0 ? 6 : day - 1
  }

  const prevMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1))
  }

  const nextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1))
  }

  const isToday = (day: number) => {
    const today = new Date()
    return day === today.getDate() &&
      currentDate.getMonth() === today.getMonth() &&
      currentDate.getFullYear() === today.getFullYear()
  }

  // --- Form Handlers ---

  const handleSubmit = async () => {
    if (!newItem.job_code || !newItem.start_date || !newItem.technician_id || !newItem.customer_id) {
      alert("Vui lòng điền đầy đủ thông tin (Mã, Khách hàng, Ngày, Kỹ thuật viên)")
      return
    }

    setIsSubmitting(true)
    try {
      const startDateTime = new Date(`${newItem.start_date}T${newItem.start_time || '09:00'}:00`).toISOString()
      const endDateTime = new Date(new Date(startDateTime).getTime() + 2 * 60 * 60 * 1000).toISOString()

      const payload = {
        job_code: newItem.job_code,
        customer_id: newItem.customer_id,
        job_type: newItem.job_type,
        scheduled_start_time: startDateTime,
        scheduled_end_time: endDateTime,
        notes: newItem.notes,
        assigned_technician_id: newItem.technician_id || undefined
      }

      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || "Failed to create")
      }

      alert("Tạo công việc thành công!")
      setShowCreateModal(false)
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

  // --- Render Helpers ---

  const daysInMonth = getDaysInMonth(currentDate)
  const startDayOffset = getFirstDayOfMonth(currentDate)
  const monthNames = ["Tháng 1", "Tháng 2", "Tháng 3", "Tháng 4", "Tháng 5", "Tháng 6",
    "Tháng 7", "Tháng 8", "Tháng 9", "Tháng 10", "Tháng 11", "Tháng 12"]

  // Get jobs for a specific day
  const getJobsForDay = (day: number) => {
    return jobs.filter(job => {
      if (!job.scheduled_start_time) return false
      const jobDate = new Date(job.scheduled_start_time)
      return jobDate.getDate() === day &&
        jobDate.getMonth() === currentDate.getMonth() &&
        jobDate.getFullYear() === currentDate.getFullYear()
    })
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="border-b border-border p-3 md:p-4 flex items-center justify-between bg-card">
        <div className="flex items-center gap-2 md:gap-4">
          <MobileMenuButton />
          <div className="flex items-center gap-2">
            <h2 className="text-lg md:text-xl font-bold">
              {monthNames[currentDate.getMonth()]} {currentDate.getFullYear()}
            </h2>
            <div className="flex items-center rounded-md border border-input h-8">
              <button onClick={prevMonth} className="px-2 h-full hover:bg-muted border-r border-input">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button onClick={nextMonth} className="px-2 h-full hover:bg-muted">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {canCreateJob && (
          <Button onClick={() => setShowCreateModal(true)} size="sm" className="gap-2">
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">Tạo lịch hẹn</span>
          </Button>
        )}
      </div>

      {/* Calendar Grid */}
      <div className="flex-1 overflow-auto p-2 md:p-4">
        {/* Days Header */}
        <div className="grid grid-cols-7 mb-2 text-center">
          {['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].map(day => (
            <div key={day} className="text-sm font-semibold text-muted-foreground py-2">
              {day}
            </div>
          ))}
        </div>

        {/* Days Grid */}
        <div className="grid grid-cols-7 gap-1 md:gap-2 auto-rows-fr">
          {/* Empty cells for offset */}
          {Array.from({ length: startDayOffset }).map((_, i) => (
            <div key={`empty-${i}`} className="min-h-[100px] bg-muted/20 rounded-md" />
          ))}

          {/* Days */}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = i + 1
            const dayJobs = getJobsForDay(day)

            return (
              <div
                key={day}
                className={`min-h-[100px] md:min-h-[120px] p-2 rounded-md border ${isToday(day) ? 'border-primary bg-primary/5' : 'border-border bg-card'
                  } flex flex-col gap-1 overflow-hidden transition-all hover:border-primary/50 relative group`}
              >
                <span className={`text-sm font-medium w-6 h-6 flex items-center justify-center rounded-full mb-1 ${isToday(day) ? 'bg-primary text-primary-foreground' : 'text-foreground'
                  }`}>
                  {day}
                </span>

                <div className="flex flex-col gap-1 overflow-y-auto max-h-[150px] scrollbar-thin">
                  {dayJobs.map(job => (
                    <div
                      key={job.id}
                      className={`text-[10px] md:text-xs p-1.5 rounded border truncate cursor-pointer ${job.status === 'Ho_n_th_nh' ? 'bg-green-50 border-green-200 text-green-800 dark:bg-green-900/20 dark:border-green-800 dark:text-green-300' :
                          job.status === 'M_i' ? 'bg-blue-50 border-blue-200 text-blue-800 dark:bg-blue-900/20 dark:border-blue-800 dark:text-blue-300' :
                            'bg-slate-50 border-slate-200 text-slate-800 dark:bg-slate-800/50 dark:border-slate-700 dark:text-slate-300'
                        }`}
                      title={`${job.job_code} - ${job.customers?.company_name}`}
                    >
                      <div className="font-semibold truncate">{job.customers?.company_name}</div>
                      <div className="truncate opacity-75">{job.job_code}</div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Create Modal */}
      <Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Tạo lịch hẹn mới</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Mã công việc</label>
                <Input
                  placeholder="VD: JOB-001"
                  value={newItem.job_code}
                  onChange={(e) => setNewItem({ ...newItem, job_code: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Loại</label>
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

            <div className="space-y-2">
              <label className="text-sm font-medium">Khách hàng</label>
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

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Ngày bắt đầu</label>
                <Input
                  type="date"
                  value={newItem.start_date}
                  onChange={(e) => setNewItem({ ...newItem, start_date: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Giờ bắt đầu</label>
                <Input
                  type="time"
                  value={newItem.start_time}
                  onChange={(e) => setNewItem({ ...newItem, start_time: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Phân công kỹ thuật</label>
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
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Ghi chú</label>
              <Input
                placeholder="Ghi chú thêm..."
                value={newItem.notes}
                onChange={(e) => setNewItem({ ...newItem, notes: e.target.value })}
              />
            </div>

            <Button className="w-full mt-4" onClick={handleSubmit} disabled={isSubmitting}>
              {isSubmitting ? "Đang tạo..." : "Tạo công việc"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

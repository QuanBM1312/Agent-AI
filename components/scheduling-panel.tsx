"use client"

import { useState, useEffect, useMemo, useCallback, useRef } from "react"
import { Plus, ChevronLeft, ChevronRight, X, Search, Clock, Calendar, Briefcase, User, FileText, ClipboardList, CheckCircle2, AlertCircle, Flag } from "lucide-react"
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
  actual_end_time?: string | null
  status: string
  customer_id: string
  assigned_technician_id?: string | null
  notes?: string | null
  customers: {
    company_name: string
  }
  users_jobs_assigned_technician_idTousers?: {
    full_name: string
    email: string
  }
  job_line_items?: {
    id: string
    quantity: number
    unit_price: number
    materials_and_services: {
      name: string
      unit: string
    }
  }[]
  job_technicians?: {
    users: {
      id: string
      full_name: string
    }
  }[]
  job_reports?: {
    id: string
    problem_summary: string
    actions_taken: string
    timestamp: string
    users: {
      full_name: string
    }
  }[]
}

// Helper to get local date string YYYY-MM-DD
const getLocalDateString = (date: Date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function SchedulingPanel({ userRole }: SchedulingPanelProps) {
  const [jobs, setJobs] = useState<Job[]>([])
  const [technicians, setTechnicians] = useState<{ id: string, full_name: string }[]>([])
  const [customers, setCustomers] = useState<{ 
    id: string
    company_name: string
    contact_person: string | null
    phone: string | null
    address: string | null
  }[]>([])
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [selectedJob, setSelectedJob] = useState<Job | null>(null)
  const [showDetailModal, setShowDetailModal] = useState(false)
  const [isLoadingDetails, setIsLoadingDetails] = useState(false)
  const [isEditMode, setIsEditMode] = useState(false)
  const [editItem, setEditItem] = useState({
    job_code: '',
    job_type: 'Lắp đặt mới',
    start_date: '',
    start_time: '',
    end_time: '',
    customer_id: '',
    technician_ids: [] as string[],
    notes: '',
    status: '',
    end_date: ''
  })

  // Calendar State
  const [currentDate, setCurrentDate] = useState(new Date())
  const [selectedDate, setSelectedDate] = useState(new Date())

  // Form State
  const [newItem, setNewItem] = useState({
    job_code: '',
    job_type: 'Lắp đặt mới',
    start_date: '',
    start_time: '',
    customer_id: '',
    technician_ids: [] as string[], // Changed to array
    notes: ''
  })
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [technicianSearch, setTechnicianSearch] = useState('')
  const [isTechListOpen, setIsTechListOpen] = useState(false)
  const techListRef = useRef<HTMLDivElement>(null)

  // Handle click outside to close technician list
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (techListRef.current && !techListRef.current.contains(event.target as Node)) {
        setIsTechListOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  // Permissions
  const canCreateJob = ["Admin", "Manager"].includes(userRole)

  const fetchJobs = useCallback(async () => {
    try {
      const year = currentDate.getFullYear()
      const month = currentDate.getMonth()
      const startOfMonth = new Date(year, month, 1).toISOString()
      const endOfMonth = new Date(year, month + 1, 0, 23, 59, 59, 999).toISOString()

      // Fetch jobs only for the current month view
      const res = await fetch(`/api/jobs?startDate=${startOfMonth}&endDate=${endOfMonth}&limit=200`)
      if (res.ok) {
        const data = await res.json()
        setJobs(data.data || [])
      }
    } catch (error) {
      console.error("Failed to fetch jobs", error)
    }
  }, [currentDate])

  const handleJobClick = async (jobId: string) => {
    setIsLoadingDetails(true)
    setShowDetailModal(true)
    try {
      const res = await fetch(`/api/jobs/${jobId}`)
      if (res.ok) {
        const data = await res.json()
        setSelectedJob(data.job)
        setIsEditMode(false) // Reset edit mode when viewing a new job
      } else {
        alert("Không thể tải chi tiết công việc")
        setShowDetailModal(false)
      }
    } catch (error) {
      console.error("Error fetching job details:", error)
      alert("Lỗi kết nối")
      setShowDetailModal(false)
    } finally {
      setIsLoadingDetails(false)
    }
  }

  const handleUpdate = async () => {
    if (!selectedJob) return

    // Validation: Must have at least one technician
    if (editItem.technician_ids.length === 0) {
      alert("Vui lòng chọn ít nhất một kỹ thuật viên")
      return
    }

    setIsSubmitting(true)
    try {
      const startDateTime = new Date(`${editItem.start_date}T${editItem.start_time || '09:00'}:00`).toISOString()
      const endDateTime = new Date(`${editItem.start_date}T${editItem.end_time || '11:00'}:00`).toISOString()

      const payload = {
        job_code: editItem.job_code,
        customer_id: editItem.customer_id,
        job_type: editItem.job_type,
        scheduled_start_time: startDateTime,
        scheduled_end_time: endDateTime,
        notes: editItem.notes,
        status: editItem.status,
        assigned_technician_ids: editItem.technician_ids
      }

      const res = await fetch(`/api/jobs/${selectedJob.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      })

      if (res.ok) {
        alert("Cập nhật công việc thành công!")
        setIsEditMode(false)
        handleJobClick(selectedJob.id) // Refresh details
        fetchJobs() // Refresh calendar
      } else {
        const err = await res.json()
        throw new Error(err.error || "Failed to update")
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Đã xảy ra lỗi không xác định";
      alert(`Lỗi: ${message}`)
    } finally {
      setIsSubmitting(false)
    }
  }

  const startEditing = () => {
    if (!selectedJob) return
    const startDate = selectedJob.scheduled_start_time ? getLocalDateString(new Date(selectedJob.scheduled_start_time)) : ''
    const startTime = selectedJob.scheduled_start_time ? new Date(selectedJob.scheduled_start_time).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false }) : '09:00'
    const endTime = (selectedJob.status === 'Ho_n_t_t___n' || selectedJob.status === 'Hoàn tất đơn') && selectedJob.actual_end_time 
      ? new Date(selectedJob.actual_end_time).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false })
      : selectedJob.scheduled_end_time 
        ? new Date(selectedJob.scheduled_end_time).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false }) 
        : '11:00'
    const endDate = (selectedJob.status === 'Ho_n_t_t___n' || selectedJob.status === 'Hoàn tất đơn') && selectedJob.actual_end_time
      ? getLocalDateString(new Date(selectedJob.actual_end_time))
      : selectedJob.scheduled_end_time 
        ? getLocalDateString(new Date(selectedJob.scheduled_end_time))
        : startDate

    const currentTechIds = selectedJob.job_technicians?.map(jt => jt.users.id) ||
      (selectedJob.assigned_technician_id ? [selectedJob.assigned_technician_id] : [])

    setEditItem({
      job_code: selectedJob.job_code,
      job_type: selectedJob.job_type === 'L_p___t_m_i' ? 'Lắp đặt mới' : selectedJob.job_type === 'B_o_h_nh' ? 'Bảo hành' : 'Sửa chữa',
      start_date: startDate,
      start_time: startTime,
      end_time: endTime,
      customer_id: selectedJob.customer_id,
      technician_ids: currentTechIds,
      notes: selectedJob.notes || '',
      status: (selectedJob.status === 'ph_n_c_ng' || selectedJob.status === 'Đã phân công') ? 'Đã phân công' : 
              (selectedJob.status === 'Ch_duy_t' || selectedJob.status === 'Chờ duyệt') ? 'Chờ duyệt' : 
              (selectedJob.status === 'Ho_n_th_nh' || selectedJob.status === 'Đã duyệt') ? 'Đã duyệt' : 
              (selectedJob.status === 'Ho_n_t_t___n' || selectedJob.status === 'Hoàn tất đơn') ? 'Hoàn tất đơn' : 'Chờ duyệt',
      end_date: endDate
    })
    setIsEditMode(true)
  }

  // Initial load
  useEffect(() => {
    fetchJobs()
  }, [fetchJobs])

  // Fetch Dropdown Data
  useEffect(() => {
    if (canCreateJob) {
      const fetchData = async () => {
        try {
          const [techRes, custRes] = await Promise.all([
            fetch("/api/users?role=Technician&limit=100"),
            fetch("/api/customers")
          ])

          if (techRes.ok) {
            const techData = await techRes.json()
            if (techData.data && Array.isArray(techData.data)) setTechnicians(techData.data)
          }

          if (custRes.ok) {
            const custData = await custRes.json()
            if (custData.data && Array.isArray(custData.data)) setCustomers(custData.data)
          }
        } catch (error) {
          console.error("Failed to fetch dropdown data", error)
        }
      }
      fetchData()
    }
  }, [canCreateJob])

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
    if (!newItem.job_code || !newItem.start_date || newItem.technician_ids.length === 0 || !newItem.customer_id) {
      alert("Vui lòng điền đầy đủ thông tin (Mã, Khách hàng, Ngày, Kỹ thuật viên)")
      return
    }

    setIsSubmitting(true)
    try {
      const startDateTime = new Date(`${newItem.start_date}T${newItem.start_time || '09:00'}:00`).toISOString()
      
      // Default to 2 hours after start for planning purposes
      const endDateTime = new Date(new Date(startDateTime).getTime() + 2 * 60 * 60 * 1000).toISOString()


      const payload = {
        job_code: newItem.job_code,
        customer_id: newItem.customer_id,
        job_type: newItem.job_type,
        scheduled_start_time: startDateTime,
        scheduled_end_time: endDateTime,
        notes: newItem.notes,
        assigned_technician_ids: newItem.technician_ids // Send array
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
        start_date: getLocalDateString(selectedDate),
        start_time: '',
        customer_id: '',
        technician_ids: [],
        notes: ''
      })
      fetchJobs()

    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Đã xảy ra lỗi không xác định";
      alert(`Lỗi: ${message}`)
    } finally {
      setIsSubmitting(false)
    }
  }

  // --- Render Helpers ---

  const daysInMonth = getDaysInMonth(currentDate)
  const startDayOffset = getFirstDayOfMonth(currentDate)
  const monthNames = ["Tháng 1", "Tháng 2", "Tháng 3", "Tháng 4", "Tháng 5", "Tháng 6",
    "Tháng 7", "Tháng 8", "Tháng 9", "Tháng 10", "Tháng 11", "Tháng 12"]

  // Memoize jobs grouped by day to optimize calendar rendering
  const jobsByDay = useMemo(() => {
    const map: Record<number, Job[]> = {}
    jobs.forEach(job => {
      if (job.scheduled_start_time) {
        const jobDate = new Date(job.scheduled_start_time)
        // Only map if it belongs to current month/year view
        if (jobDate.getMonth() === currentDate.getMonth() && jobDate.getFullYear() === currentDate.getFullYear()) {
          const d = jobDate.getDate()
          if (!map[d]) map[d] = []
          map[d].push(job)
        }
      }
    })
    return map
  }, [jobs, currentDate])

  // Get jobs for a specific day
  const getJobsForDay = (day: number) => {
    return jobsByDay[day] || []
  }

  // Get status color based on job status with enhanced visibility
  const getStatusColor = (status: string) => {
    // Handle null/undefined
    if (!status) {
      return 'bg-slate-100 border-l-4 border-l-slate-400 border-y border-r border-slate-300 text-slate-900 dark:bg-slate-800/50 dark:border-l-slate-500 dark:border-y dark:border-r dark:border-slate-600 dark:text-slate-200'
    }

    // Normalize status to handle both Vietnamese text and enum values
    const normalizedStatus = status.trim()

    // Check for "Đã duyệt" (Approved) status
    if (normalizedStatus === 'Ho_n_th_nh' || normalizedStatus === 'Hoàn thành' || normalizedStatus === 'Đã duyệt') {
      return 'bg-green-100 border-l-4 border-l-green-500 border-y border-r border-green-400 text-green-900 dark:bg-green-900/30 dark:border-l-green-500 dark:border-y dark:border-r dark:border-green-600 dark:text-green-200'
    }

    // Check for "Hoàn tất đơn" (Completed) status
    if (normalizedStatus === 'Ho_n_t_t___n' || normalizedStatus === 'Hoàn tất đơn') {
      return 'bg-slate-100 border-l-4 border-l-slate-600 border-y border-r border-slate-400 text-slate-900 dark:bg-slate-800/50 dark:border-l-slate-600 dark:border-y dark:border-r dark:border-slate-600 dark:text-slate-200'
    }

    // Check for pending approval (both formats)
    if (normalizedStatus === 'Ch_duy_t' || normalizedStatus === 'Chờ duyệt') {
      return 'bg-amber-100 border-l-4 border-l-amber-500 border-y border-r border-amber-400 text-amber-900 dark:bg-amber-900/30 dark:border-l-amber-500 dark:border-y dark:border-r dark:border-amber-600 dark:text-amber-200'
    }

    // Check for assigned (both formats)
    if (normalizedStatus === 'ph_n_c_ng' || normalizedStatus === 'Đã phân công') {
      return 'bg-blue-100 border-l-4 border-l-blue-500 border-y border-r border-blue-400 text-blue-900 dark:bg-blue-900/30 dark:border-l-blue-500 dark:border-y dark:border-r dark:border-blue-600 dark:text-blue-200'
    }

    // Default for unknown status
    console.warn('⚠️ Unknown status value:', status)
    return 'bg-slate-100 border-l-4 border-l-slate-400 border-y border-r border-slate-300 text-slate-900 dark:bg-slate-800/50 dark:border-l-slate-500 dark:border-y dark:border-r dark:border-slate-600 dark:text-slate-200'
  }

  // Get status icon for visual indicator
  const getStatusIcon = (status: string) => {
    if (!status) return null

    const normalizedStatus = status.trim()

    // Approved / Done
    if (normalizedStatus === 'Ho_n_th_nh' || normalizedStatus === 'Đã duyệt') {
      return <CheckCircle2 className="w-3 h-3 text-green-600 dark:text-green-400 flex-shrink-0" />
    }

    // Finalized
    if (normalizedStatus === 'Ho_n_t_t___n' || normalizedStatus === 'Hoàn tất đơn') {
      return <Flag className="w-3 h-3 text-slate-600 dark:text-slate-400 flex-shrink-0" />
    }

    // Pending approval
    if (normalizedStatus === 'Ch_duy_t' || normalizedStatus === 'Chờ duyệt') {
      return <Clock className="w-3 h-3 text-amber-600 dark:text-amber-400 flex-shrink-0" />
    }

    // Assigned
    if (normalizedStatus === 'ph_n_c_ng' || normalizedStatus === 'Đã phân công') {
      return <AlertCircle className="w-3 h-3 text-blue-600 dark:text-blue-400 flex-shrink-0" />
    }

    return null
  }


  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="border-b border-border p-3 md:p-4 flex items-center justify-between bg-card">
        <div className="flex flex-col gap-2">
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
          {/* Legend */}
          <div className="flex items-center gap-3 text-xs ml-8 md:ml-0">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full bg-blue-400 border-2 border-blue-600 dark:bg-blue-500 dark:border-blue-400"></div>
              <span>Đã phân công</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full bg-amber-400 border-2 border-amber-600 dark:bg-amber-500 dark:border-amber-400"></div>
              <span>Chờ duyệt</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full bg-green-400 border-2 border-green-600 dark:bg-green-500 dark:border-green-400"></div>
              <span>Đã duyệt</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full bg-slate-400 border-2 border-slate-600 dark:bg-slate-500 dark:border-slate-400"></div>
              <span>Hoàn tất đơn</span>
            </div>
          </div>
        </div>

        {canCreateJob && (
          <Button 
            onClick={() => {
              setNewItem(prev => ({ ...prev, start_date: getLocalDateString(selectedDate) }))
              setShowCreateModal(true)
            }} 
            size="sm" 
            className="gap-2"
          >
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
            <div key={day} className="text-xs md:text-sm font-semibold text-muted-foreground py-2">
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
            const isSelected = selectedDate.getDate() === day &&
              selectedDate.getMonth() === currentDate.getMonth() &&
              selectedDate.getFullYear() === currentDate.getFullYear()

            return (
              <div
                key={day}
                onClick={() => setSelectedDate(new Date(currentDate.getFullYear(), currentDate.getMonth(), day))}
                className={`min-h-[50px] md:min-h-[120px] p-1 md:p-2 rounded-md border flex flex-col gap-1 overflow-hidden transition-all hover:border-primary/50 relative group cursor-pointer ${isToday(day) ? 'border-primary bg-primary/5' :
                  isSelected ? 'border-primary shadow-sm bg-accent/50' : 'border-border bg-card'
                  }`}
              >
                <span className={`text-[10px] md:text-sm font-medium w-5 h-5 md:w-6 md:h-6 flex items-center justify-center rounded-full mb-1 ${isToday(day) ? 'bg-primary text-primary-foreground' : 'text-foreground'
                  }`}>
                  {day}
                </span>

                {/* Desktop View: Full Blocks */}
                <div className="hidden md:flex flex-col gap-1 overflow-y-auto max-h-[150px] scrollbar-thin">
                  {dayJobs.map(job => (
                    <div
                      key={job.id}
                      className={`text-[10px] md:text-xs p-1.5 rounded cursor-pointer ${getStatusColor(job.status)}`}
                      title={`${job.job_code} - ${job.customers?.company_name} (${job.status})`}
                      onClick={(e) => {
                        e.stopPropagation()
                        handleJobClick(job.id)
                      }}
                    >
                      <div className="flex items-center gap-1 mb-0.5">
                        {getStatusIcon(job.status)}
                        <div className="font-semibold truncate">{job.customers?.company_name}</div>
                      </div>
                      <div className="truncate opacity-75 text-[9px] md:text-[10px]">{job.job_code}</div>
                    </div>
                  ))}
                </div>

                {/* Mobile View: Dots */}
                <div className="flex md:hidden flex-wrap gap-1 content-start">
                  {dayJobs.map(job => {
                    let colorClass = "bg-slate-400"
                    const s = job.status?.trim()
                    if (s === 'Ho_n_th_nh' || s === 'Hoàn thành' || s === 'Đã duyệt') colorClass = "bg-green-500"
                    else if (s === 'Ho_n_t_t___n' || s === 'Hoàn tất đơn') colorClass = "bg-slate-600"
                    else if (s === 'Ch_duy_t' || s === 'Chờ duyệt') colorClass = "bg-amber-500"
                    else if (s === 'ph_n_c_ng' || s === 'Đã phân công') colorClass = "bg-blue-500"

                    return (
                      <div
                        key={job.id}
                        className={`w-1.5 h-1.5 rounded-full ${colorClass}`}
                      />
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>

        {/* Selected Date Details (Mobile & Desktop) */}
        <div className="mt-6 border-t pt-4">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <Calendar className="w-4 h-4 text-primary" />
            Công việc ngày {selectedDate.toLocaleDateString('vi-VN')}
          </h3>

          <div className="space-y-2">
            {getJobsForDay(selectedDate.getDate()).length === 0 ? (
              <p className="text-sm text-muted-foreground italic">Không có công việc nào trong ngày này.</p>
            ) : (
              getJobsForDay(selectedDate.getDate()).map(job => (
                <div
                  key={job.id}
                  onClick={() => handleJobClick(job.id)}
                  className={`p-3 rounded-lg border flex items-center justify-between cursor-pointer ${getStatusColor(job.status)}`}
                >
                  <div className="flex flex-col gap-1 overflow-hidden">
                    <div className="flex items-center gap-2">
                      {getStatusIcon(job.status)}
                      <span className="font-semibold truncate">{job.customers?.company_name}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs opacity-80">
                      <span className="font-medium bg-background/50 px-1.5 py-0.5 rounded">{job.job_code}</span>
                      <span>•</span>
                      <span>{job.scheduled_start_time ? new Date(job.scheduled_start_time).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '--:--'}</span>
                    </div>
                    {job.notes && (
                      <p className="text-xs truncate italic mt-0.5 max-w-[200px] md:max-w-full">
                        {job.notes}
                      </p>
                    )}
                  </div>
                  <ChevronRight className="w-4 h-4 opacity-50 flex-shrink-0 ml-2" />
                </div>
              ))
            )}
          </div>
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

            {/* Customer Details Display - Derived from selection */}
            {newItem.customer_id && (() => {
               const selectedCustomer = customers.find(c => c.id === newItem.customer_id);
               return (
                 <div className="grid grid-cols-3 gap-4 p-3 bg-muted/30 rounded-lg border border-border/50">
                    <div className="space-y-1">
                      <span className="text-xs text-muted-foreground font-medium">Tên khách hàng</span>
                      <div className="font-medium text-sm truncate" title={selectedCustomer?.contact_person || ''}>
                        {selectedCustomer?.contact_person || '--'}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <span className="text-xs text-muted-foreground font-medium">SĐT liên hệ</span>
                      <div className="font-medium text-sm truncate" title={selectedCustomer?.phone || ''}>
                        {selectedCustomer?.phone || '--'}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <span className="text-xs text-muted-foreground font-medium">Địa chỉ</span>
                      <div className="font-medium text-sm truncate" title={selectedCustomer?.address || ''}>
                        {selectedCustomer?.address || '--'}
                      </div>
                    </div>
                 </div>
               );
            })()}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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

              <div className="relative" ref={techListRef}>
                {/* Search Input & Toggle */}
                <div
                  className="relative cursor-pointer"
                  onClick={() => setIsTechListOpen(!isTechListOpen)}
                >
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Tìm kiếm kỹ thuật viên..."
                    value={technicianSearch}
                    onChange={(e) => {
                      setTechnicianSearch(e.target.value)
                      if (!isTechListOpen) setIsTechListOpen(true)
                    }}
                    onFocus={() => setIsTechListOpen(true)}
                    className="pl-9 pr-10"
                  />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
                    <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground font-medium">
                      {newItem.technician_ids.length}
                    </span>
                    <ChevronRight className={`w-4 h-4 text-muted-foreground transition-transform ${isTechListOpen ? 'rotate-90' : ''}`} />
                  </div>
                </div>

                {/* Dropdown List */}
                {isTechListOpen && (
                  <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border border-border rounded-md shadow-lg overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                    <div className="max-h-60 overflow-y-auto p-1">
                      {technicians.length === 0 ? (
                        <p className="text-sm text-muted-foreground p-3 text-center">Không có kỹ thuật viên</p>
                      ) : (
                        technicians
                          .filter(tech =>
                            tech.full_name.toLowerCase().includes(technicianSearch.toLowerCase())
                          )
                          .map(tech => {
                            const isSelected = newItem.technician_ids.includes(tech.id)
                            return (
                              <div
                                key={tech.id}
                                className={`flex items-center gap-3 px-3 py-2.5 rounded-sm cursor-pointer transition-colors ${isSelected ? 'bg-primary/10 text-primary' : 'hover:bg-muted'
                                  }`}
                                onClick={() => {
                                  if (isSelected) {
                                    setNewItem({ ...newItem, technician_ids: newItem.technician_ids.filter(id => id !== tech.id) })
                                  } else {
                                    setNewItem({ ...newItem, technician_ids: [...newItem.technician_ids, tech.id] })
                                  }
                                }}
                              >
                                <div className={`w-4 h-4 rounded-sm border flex items-center justify-center transition-colors ${isSelected ? 'bg-primary border-primary' : 'border-input bg-background'
                                  }`}>
                                  {isSelected && <div className="w-2 h-2 bg-primary-foreground rounded-full" />}
                                </div>
                                <div className="flex flex-col">
                                  <span className="text-sm font-medium">{tech.full_name}</span>
                                  <span className="text-[10px] opacity-70">Sẵn sàng</span>
                                </div>
                              </div>
                            )
                          })
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Selected Technicians Tags */}
              {newItem.technician_ids.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {newItem.technician_ids.map(techId => {
                    const tech = technicians.find(t => t.id === techId)
                    return tech ? (
                      <div key={techId} className="group flex items-center gap-1.5 bg-secondary hover:bg-secondary/80 text-secondary-foreground pl-2.5 pr-1 py-1 rounded-full text-xs font-medium transition-colors border border-transparent hover:border-border">
                        <span>{tech.full_name}</span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            setNewItem({
                              ...newItem,
                              technician_ids: newItem.technician_ids.filter(id => id !== techId)
                            })
                          }}
                          className="hover:bg-destructive hover:text-destructive-foreground rounded-full p-0.5 transition-colors"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ) : null
                  })}
                </div>
              )}
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
      {/* Job Details Modal */}
      <Dialog open={showDetailModal} onOpenChange={setShowDetailModal}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardList className="w-5 h-5 text-primary" />
              Chi tiết công việc
            </DialogTitle>
          </DialogHeader>

          {isLoadingDetails ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-muted-foreground font-medium">Đang tải chi tiết...</p>
            </div>
          ) : selectedJob && (
            <div className="space-y-6 py-4">
              {isEditMode ? (
                /* Edit Mode */
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase text-muted-foreground">Mã công việc</label>
                      <Input
                        value={editItem.job_code}
                        onChange={(e) => setEditItem({ ...editItem, job_code: e.target.value })}
                        disabled={editItem.status === 'Ho_n_t_t___n' || editItem.status === 'Hoàn tất đơn'} 
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase text-muted-foreground">Trạng thái</label>
                      <Input
                        value={editItem.status}
                        readOnly
                        className="bg-muted cursor-not-allowed font-medium"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase text-muted-foreground">Ngày bắt đầu</label>
                      <Input
                        type="date"
                        value={editItem.start_date}
                        onChange={(e) => setEditItem({ ...editItem, start_date: e.target.value })}
                        disabled={editItem.status === 'Ho_n_t_t___n' || editItem.status === 'Hoàn tất đơn'}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase text-muted-foreground">Giờ bắt đầu</label>
                      <Input
                        type="time"
                        value={editItem.start_time}
                        onChange={(e) => setEditItem({ ...editItem, start_time: e.target.value })}
                        disabled={editItem.status === 'Ho_n_t_t___n' || editItem.status === 'Hoàn tất đơn'}
                      />
                    </div>
                  </div>

                  {editItem.status === 'Hoàn tất đơn' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-xs font-bold uppercase text-muted-foreground">Ngày kết thúc</label>
                        <Input
                          type="date"
                          value={editItem.end_date}
                          onChange={(e) => setEditItem({ ...editItem, end_date: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-bold uppercase text-muted-foreground">Giờ kết thúc</label>
                        <Input
                          type="time"
                          value={editItem.end_time}
                          onChange={(e) => setEditItem({ ...editItem, end_time: e.target.value })}
                        />
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase text-muted-foreground">Khách hàng</label>
                      <select
                        className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
                        value={editItem.customer_id}
                        onChange={(e) => setEditItem({ ...editItem, customer_id: e.target.value })}
                        disabled={editItem.status === 'Ho_n_t_t___n' || editItem.status === 'Hoàn tất đơn'}
                      >
                        <option value="">-- Chọn khách hàng --</option>
                        {customers.map(cust => (
                          <option key={cust.id} value={cust.id}>
                            {cust.company_name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase text-muted-foreground">Loại công việc</label>
                      <select
                        className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
                        value={editItem.job_type}
                        onChange={(e) => setEditItem({ ...editItem, job_type: e.target.value })}
                        disabled={editItem.status === 'Ho_n_t_t___n' || editItem.status === 'Hoàn tất đơn'}
                      >
                        <option value="Lắp đặt mới">Lắp đặt mới</option>
                        <option value="Bảo hành">Bảo hành</option>
                        <option value="Sửa chữa">Sửa chữa</option>
                      </select>
                    </div>
                  </div>

                  {/* Customer Details Display - Derived from selection */}
                  {editItem.customer_id && (() => {
                     const selectedCustomer = customers.find(c => c.id === editItem.customer_id);
                     return (
                       <div className="grid grid-cols-3 gap-4 p-3 bg-muted/30 rounded-lg border border-border/50">
                          <div className="space-y-1">
                            <span className="text-xs text-muted-foreground font-medium">Tên khách hàng</span>
                            <div className="font-medium text-sm truncate" title={selectedCustomer?.contact_person || ''}>
                              {selectedCustomer?.contact_person || '--'}
                            </div>
                          </div>
                          <div className="space-y-1">
                            <span className="text-xs text-muted-foreground font-medium">SĐT liên hệ</span>
                            <div className="font-medium text-sm truncate" title={selectedCustomer?.phone || ''}>
                              {selectedCustomer?.phone || '--'}
                            </div>
                          </div>
                          <div className="space-y-1">
                            <span className="text-xs text-muted-foreground font-medium">Địa chỉ</span>
                            <div className="font-medium text-sm truncate" title={selectedCustomer?.address || ''}>
                              {selectedCustomer?.address || '--'}
                            </div>
                          </div>
                       </div>
                     );
                  })()}

                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase text-muted-foreground">Phân công kỹ thuật</label>

                    <div className="relative" ref={techListRef}>
                      {/* Search Input & Toggle */}
                      <div
                        className={`relative ${!(editItem.status === 'Ho_n_t_t___n' || editItem.status === 'Hoàn tất đơn') ? 'cursor-pointer' : 'cursor-not-allowed opacity-70'}`}
                        onClick={() => {
                           if (!(editItem.status === 'Ho_n_t_t___n' || editItem.status === 'Hoàn tất đơn')) {
                              setIsTechListOpen(!isTechListOpen)
                           }
                        }}
                      >
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input
                          placeholder="Tìm kiếm kỹ thuật viên..."
                          value={technicianSearch}
                          onChange={(e) => {
                            setTechnicianSearch(e.target.value)
                            if (!isTechListOpen) setIsTechListOpen(true)
                          }}
                          onFocus={() => setIsTechListOpen(true)}
                          className="pl-9 pr-10"
                        />
                        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
                          <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground font-medium">
                            {editItem.technician_ids.length}
                          </span>
                          <ChevronRight className={`w-4 h-4 text-muted-foreground transition-transform ${isTechListOpen ? 'rotate-90' : ''}`} />
                        </div>
                      </div>

                      {/* Dropdown List */}
                      {isTechListOpen && (
                        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border border-border rounded-md shadow-lg overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                          <div className="max-h-60 overflow-y-auto p-1">
                            {technicians.length === 0 ? (
                              <p className="text-sm text-muted-foreground p-3 text-center">Không có kỹ thuật viên</p>
                            ) : (
                              technicians
                                .filter(tech => tech.full_name.toLowerCase().includes(technicianSearch.toLowerCase()))
                                .map(tech => {
                                  const isSelected = editItem.technician_ids.includes(tech.id)
                                  return (
                                    <div
                                      key={tech.id}
                                      className={`flex items-center gap-3 px-3 py-2.5 rounded-sm cursor-pointer transition-colors ${isSelected ? 'bg-primary/10 text-primary' : 'hover:bg-muted'
                                        }`}
                                      onClick={() => {
                                        if (isSelected) {
                                          setEditItem({ ...editItem, technician_ids: editItem.technician_ids.filter(id => id !== tech.id) })
                                        } else {
                                          setEditItem({ ...editItem, technician_ids: [...editItem.technician_ids, tech.id] })
                                        }
                                      }}
                                    >
                                      <div className={`w-4 h-4 rounded-sm border flex items-center justify-center transition-colors ${isSelected ? 'bg-primary border-primary' : 'border-input bg-background'
                                        }`}>
                                        {isSelected && <div className="w-2 h-2 bg-primary-foreground rounded-full" />}
                                      </div>
                                      <div className="flex flex-col">
                                        <span className="text-sm font-medium">{tech.full_name}</span>
                                        <span className="text-[10px] opacity-70">Sẵn sàng</span>
                                      </div>
                                    </div>
                                  )
                                })
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Selected Technicians Tags */}
                    {editItem.technician_ids.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {editItem.technician_ids.map(techId => {
                          const tech = technicians.find(t => t.id === techId)
                          return tech ? (
                            <div key={techId} className="group flex items-center gap-1.5 bg-secondary hover:bg-secondary/80 text-secondary-foreground pl-2.5 pr-1 py-1 rounded-full text-xs font-medium transition-colors border border-transparent hover:border-border">
                              <span>{tech.full_name}</span>
                                <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  // Disable removal if completed
                                  if (!(editItem.status === 'Ho_n_t_t___n' || editItem.status === 'Hoàn tất đơn')) {
                                    setEditItem({
                                      ...editItem,
                                      technician_ids: editItem.technician_ids.filter(id => id !== techId)
                                    })
                                  }
                                }}
                                className={`hover:bg-destructive hover:text-destructive-foreground rounded-full p-0.5 transition-colors ${
                                   (editItem.status === 'Ho_n_t_t___n' || editItem.status === 'Hoàn tất đơn') ? 'hidden' : ''
                                }`}
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          ) : null
                        })}
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase text-muted-foreground">Ghi chú</label>
                    <Input
                       value={editItem.notes}
                       onChange={(e) => setEditItem({ ...editItem, notes: e.target.value })}
                       disabled={editItem.status === 'Ho_n_t_t___n' || editItem.status === 'Hoàn tất đơn'}
                    />
                  </div>

                  <div className="flex gap-2 pt-4">
                    {(editItem.status === 'Ho_n_t_t___n' || editItem.status === 'Hoàn tất đơn') ? (
                       <Button className="w-full" onClick={() => setIsEditMode(false)}>Đóng</Button>
                    ) : (
                       <>
                         <Button variant="outline" className="flex-1" onClick={() => setIsEditMode(false)}>Hủy</Button>
                         <Button className="flex-1" onClick={handleUpdate} disabled={isSubmitting}>
                           {isSubmitting ? "Đang lưu..." : "Lưu thay đổi"}
                         </Button>
                       </>
                    )}
                  </div>
                </div>
              ) : (
                /* View Mode */
                <>
                  <div className="flex justify-end mb-2">
                    {canCreateJob && (
                       (selectedJob.status === 'Ho_n_t_t___n' || selectedJob.status === 'Hoàn tất đơn') ? (
                          <Button variant="outline" size="sm" onClick={startEditing} className="gap-2">
                             <FileText className="w-3.5 h-3.5" />
                             Xem chi tiết
                          </Button>
                       ) : (
                          <Button variant="outline" size="sm" onClick={startEditing} className="gap-2">
                             <Plus className="w-3.5 h-3.5" />
                             Chỉnh sửa
                          </Button>
                       )
                    )}
                  </div>
                  {/* Top Summary */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-muted/30 p-4 rounded-xl border">
                    <div className="space-y-4">
                      <div className="flex items-start gap-3">
                        <Briefcase className="w-5 h-5 text-muted-foreground mt-0.5" />
                        <div>
                          <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Mã công việc</p>
                          <p className="text-lg font-bold text-primary">{selectedJob.job_code}</p>
                          <div className="flex flex-wrap gap-2 mt-1">
                             <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${(selectedJob.status === 'Ho_n_t_t___n' || selectedJob.status === 'Hoàn tất đơn') ? 'bg-slate-100 text-slate-800 dark:bg-slate-800/50 dark:text-slate-300' :
                              (selectedJob.status === 'Ho_n_th_nh' || selectedJob.status === 'Đã duyệt') ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' :
                              (selectedJob.status === 'Ch_duy_t' || selectedJob.status === 'Chờ duyệt') ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400' :
                              (selectedJob.status === 'ph_n_c_ng' || selectedJob.status === 'Đã phân công') ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' :
                              'bg-slate-100 text-slate-800 dark:bg-slate-800/50 dark:text-slate-300'
                             }`}>
                             {(selectedJob.status === 'Ho_n_t_t___n' || selectedJob.status === 'Hoàn tất đơn') ? 'Hoàn tất đơn' :
                              (selectedJob.status === 'Ho_n_th_nh' || selectedJob.status === 'Đã duyệt') ? 'Đã duyệt' :
                              (selectedJob.status === 'Ch_duy_t' || selectedJob.status === 'Chờ duyệt') ? 'Chờ duyệt' :
                              (selectedJob.status === 'ph_n_c_ng' || selectedJob.status === 'Đã phân công') ? 'Đã phân công' :
                              'Chờ duyệt'}
                           </span>
                           <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-secondary text-secondary-foreground border border-border">
                              {selectedJob.job_type === 'L_p___t_m_i' ? 'Lắp đặt mới' : selectedJob.job_type === 'B_o_h_nh' ? 'Bảo hành' : selectedJob.job_type || 'Lắp đặt mới'}
                           </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-start gap-3">
                        <User className="w-5 h-5 text-muted-foreground mt-0.5" />
                        <div>
                          <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Khách hàng</p>
                          <p className="font-bold">{selectedJob.customers?.company_name}</p>
                        </div>
                      </div>
                      
                      {selectedJob.notes && (
                        <div className="flex items-start gap-3 pt-2 border-t border-border/50">
                           <Flag className="w-5 h-5 text-muted-foreground mt-0.5" />
                           <div className="w-full">
                              <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Ghi chú</p>
                              <p className="text-sm italic text-slate-700 bg-white p-2 rounded border mt-1 w-full">{selectedJob.notes}</p>
                           </div>
                        </div>
                      )}
                    </div>

                    <div className="space-y-4">
                      <div className="flex items-start gap-3">
                        <Calendar className="w-5 h-5 text-muted-foreground mt-0.5" />
                        <div>
                          <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Thời gian</p>
                          <p className="font-medium">
                            {selectedJob.scheduled_start_time ? new Date(selectedJob.scheduled_start_time).toLocaleDateString('vi-VN') : 'N/A'}
                          </p>
                          <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
                            <Clock className="w-3.5 h-3.5" />
                            <span>
                              {selectedJob.scheduled_start_time ? new Date(selectedJob.scheduled_start_time).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '--'}
                              {(selectedJob.status === 'Ho_n_t_t___n' || selectedJob.status === 'Hoàn tất đơn') && (
                                <>
                                  {' - '}
                                  {selectedJob.actual_end_time 
                                    ? <span className="font-medium text-slate-900 border-b border-blue-200">
                                        {new Date(selectedJob.actual_end_time).toLocaleDateString('vi-VN')} {new Date(selectedJob.actual_end_time).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                                      </span>
                                    : selectedJob.scheduled_end_time 
                                      ? new Date(selectedJob.scheduled_end_time).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
                                      : '--'}
                                </>
                              )}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-start gap-3">
                        <User className="w-5 h-5 text-muted-foreground mt-0.5" />
                        <div className="w-full">
                          <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Kỹ thuật viên</p>
                          {selectedJob.job_technicians && selectedJob.job_technicians.length > 0 ? (
                             <div className="flex flex-col gap-1 mt-1">
                                {selectedJob.job_technicians.map((jt, idx) => (
                                   <div key={idx} className="flex items-center gap-2 bg-white px-2 py-1 rounded border shadow-sm">
                                      <div className="w-5 h-5 rounded-full bg-slate-100 flex items-center justify-center text-[10px] font-bold">
                                         {jt.users.full_name.charAt(0)}
                                      </div>
                                      <span className="text-sm font-medium">{jt.users.full_name}</span>
                                   </div>
                                ))}
                             </div>
                          ) : (
                             <>
                                <p className="font-medium">{selectedJob.users_jobs_assigned_technician_idTousers?.full_name || 'Chưa phân công'}</p>
                                <p className="text-xs text-muted-foreground">{selectedJob.users_jobs_assigned_technician_idTousers?.email}</p>
                             </>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Line Items */}
                  {selectedJob.job_line_items && selectedJob.job_line_items.length > 0 && (
                    <div className="space-y-3">
                      <h3 className="font-bold flex items-center gap-2 text-sm uppercase tracking-wider text-muted-foreground">
                        <ClipboardList className="w-4 h-4" />
                        Vật tư & Dịch vụ
                      </h3>
                      <div className="border rounded-xl overflow-hidden">
                        <table className="w-full text-sm">
                          <thead className="bg-muted/50">
                            <tr>
                              <th className="text-left p-3 font-semibold">Tên</th>
                              <th className="text-center p-3 font-semibold w-24">Số lượng</th>
                              <th className="text-center p-3 font-semibold w-20">ĐVT</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {selectedJob.job_line_items.map((item) => (
                              <tr key={item.id} className="hover:bg-muted/30 transition-colors">
                                <td className="p-3 font-medium">{item.materials_and_services.name}</td>
                                <td className="p-3 text-center">{item.quantity}</td>
                                <td className="p-3 text-center text-muted-foreground">{item.materials_and_services.unit}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Reports */}
                  {selectedJob.job_reports && selectedJob.job_reports.length > 0 && (
                    <div className="space-y-4">
                      <h3 className="font-bold flex items-center gap-2 text-sm uppercase tracking-wider text-muted-foreground">
                        <FileText className="w-4 h-4" />
                        Báo cáo thực hiện
                      </h3>
                      <div className="space-y-4">
                        {selectedJob.job_reports.map((report) => (
                          <div key={report.id} className="p-4 rounded-xl border bg-card hover:shadow-sm transition-shadow">
                            <div className="flex justify-between items-start mb-2">
                              <p className="font-bold text-sm">{report.users.full_name}</p>
                              <p className="text-xs text-muted-foreground">{new Date(report.timestamp).toLocaleString('vi-VN')}</p>
                            </div>
                            <div className="space-y-2">
                              <div>
                                <p className="text-[10px] font-bold text-muted-foreground uppercase opacity-70">Vấn đề:</p>
                                <p className="text-sm">{report.problem_summary}</p>
                              </div>
                              <div>
                                <p className="text-[10px] font-bold text-muted-foreground uppercase opacity-70">Xử lý:</p>
                                <p className="text-sm">{report.actions_taken}</p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div >
  )
}

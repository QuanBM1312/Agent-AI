"use client"

import { useState } from "react"
import { Calendar, Clock, Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

interface ScheduleItem {
  id: string
  title: string
  date: string
  time: string
  customer: string
  technician: string
}

export function SchedulingPanel() {
  const [schedules, setSchedules] = useState<ScheduleItem[]>([
    {
      id: "1",
      title: "Bảo dưỡng máy lạnh",
      date: "2024-10-25",
      time: "09:00",
      customer: "Công ty ABC",
      technician: "Anh Minh",
    },
    {
      id: "2",
      title: "Sửa chữa điều hòa",
      date: "2024-10-25",
      time: "14:00",
      customer: "Cửa hàng XYZ",
      technician: "Anh Tuấn",
    },
  ])

  const [showForm, setShowForm] = useState(false)

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="border-b border-border p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-foreground">Lịch hẹn</h2>
            <p className="text-sm text-muted-foreground mt-1">Quản lý lịch làm việc và phân công kỹ thuật viên</p>
          </div>
          <Button onClick={() => setShowForm(!showForm)} className="gap-2">
            <Plus className="w-4 h-4" />
            Tạo lịch hẹn
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {showForm && (
          <div className="mb-6 p-4 bg-card border border-border rounded-lg">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-foreground">Tạo lịch hẹn mới</h3>
              <button onClick={() => setShowForm(false)}>
                <X className="w-5 h-5 text-muted-foreground" />
              </button>
            </div>
            <div className="space-y-3">
              <Input placeholder="Tiêu đề công việc" />
              <Input type="date" />
              <Input type="time" />
              <Input placeholder="Tên khách hàng" />
              <Input placeholder="Kỹ thuật viên" />
              <div className="flex gap-2">
                <Button className="flex-1">Tạo</Button>
                <Button variant="outline" className="flex-1 bg-transparent" onClick={() => setShowForm(false)}>
                  Hủy
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Schedule List */}
        <div className="space-y-3">
          {schedules.map((schedule) => (
            <div
              key={schedule.id}
              className="p-4 bg-card border border-border rounded-lg hover:border-primary transition-colors"
            >
              <div className="flex items-start justify-between mb-3">
                <h3 className="font-semibold text-foreground">{schedule.title}</h3>
                <span className="px-2 py-1 bg-primary/10 text-primary text-xs rounded font-medium">
                  Chưa hoàn thành
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Calendar className="w-4 h-4" />
                  {schedule.date}
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Clock className="w-4 h-4" />
                  {schedule.time}
                </div>
                <div className="text-muted-foreground">
                  <span className="font-medium text-foreground">Khách:</span> {schedule.customer}
                </div>
                <div className="text-muted-foreground">
                  <span className="font-medium text-foreground">KTV:</span> {schedule.technician}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Loader2, CheckCircle2, AlertCircle, FileText, Mic, Image as ImageIcon, History, Send } from "lucide-react"

interface ReportsPanelProps {
  userRole: string
}

interface Job {
  id: string
  job_code: string
  status: string
  customers: {
    company_name: string
  }
}

interface Report {
  id: string
  job_id: string
  problem_summary: string
  actions_taken: string
  image_urls: string[]
  voice_message_url?: string
  timestamp: string
  users: {
    full_name: string
    email: string
  }
  jobs: {
    job_code: string
    status: string
    customers: {
      company_name: string
    }
  }
}

export function ReportsPanel({ userRole }: ReportsPanelProps) {
  const [activeTab, setActiveTab] = useState<"create" | "history" | "review">("create")
  const [jobs, setJobs] = useState<Job[]>([])
  const [reports, setReports] = useState<Report[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Form State
  const [selectedJobId, setSelectedJobId] = useState("")
  const [problemSummary, setProblemSummary] = useState("")
  const [actionsTaken, setActionsTaken] = useState("")
  const [imageUrl, setImageUrl] = useState("")
  const [voiceUrl, setVoiceUrl] = useState("")

  // Check roles
  const isTechnician = userRole === "Technician"
  const isManagerOrAdmin = ["Manager", "Admin"].includes(userRole)

  // Determine default tab on load
  useEffect(() => {
    if (isTechnician) setActiveTab("create")
    if (isManagerOrAdmin) setActiveTab("review")
  }, [userRole, isTechnician, isManagerOrAdmin])

  // Fetch Jobs (for dropdown)
  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch("/api/jobs")
      if (res.ok) {
        const data = await res.json()
        // Determine if data.jobs exists or data is array (based on API return structure)
        // API previously showed `return NextResponse.json({ jobs })`
        setJobs(data.jobs || [])
      }
    } catch (error) {
      console.error("Failed to fetch jobs", error)
    }
  }, [])

  // Fetch Reports
  const fetchReports = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await fetch("/api/job-reports")
      if (res.ok) {
        const data = await res.json()
        setReports(data.reports || [])
      }
    } catch (error) {
      console.error("Failed to fetch reports", error)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (activeTab === "create") fetchJobs()
    if (activeTab === "history" || activeTab === "review") fetchReports()
  }, [activeTab, fetchJobs, fetchReports])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedJobId) return alert("Vui lòng chọn công việc")
    if (!imageUrl && !voiceUrl) return alert("Vui lòng nhập link ảnh hoặc voice")

    setIsSubmitting(true)
    try {
      const res = await fetch("/api/job-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_id: selectedJobId,
          problem_summary: problemSummary,
          actions_taken: actionsTaken,
          image_urls: imageUrl ? [imageUrl] : [],
          voice_message_url: voiceUrl
        }),
      })

      if (res.ok) {
        alert("Gửi báo cáo thành công!")
        // Reset form
        setProblemSummary("")
        setActionsTaken("")
        setImageUrl("")
        setVoiceUrl("")
        setSelectedJobId("")
        // Switch to history
        setActiveTab("history")
      } else {
        const err = await res.json()
        alert(`Lỗi: ${err.error}`)
      }
    } catch (error) {
      console.error("Submit error", error)
      alert("Lỗi khi gửi báo cáo")
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleApprove = async (jobId: string, reportId: string) => {
    if (!confirm("Bạn có chắc chắn muốn duyệt báo cáo này và hoàn thành công việc?")) return

    try {
      const res = await fetch(`/api/jobs/${jobId}/approve`, {
        method: "POST"
      })

      if (res.ok) {
        alert("Đã duyệt thành công!")
        fetchReports() // Refresh list
      } else {
        const err = await res.json()
        alert(`Lỗi: ${err.error}`)
      }
    } catch (error) {
      console.error("Approve error", error)
      alert("Lỗi kết nối")
    }
  }

  return (
    <div className="flex flex-col h-full bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b px-6 py-4 flex items-center justify-between">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <FileText className="w-5 h-5 text-blue-600" />
          Quản lý Báo cáo
        </h2>
        {/* Helper Badge */}
        <span className="text-xs px-2 py-1 bg-slate-100 rounded-full font-medium text-slate-500">
          Role: {userRole}
        </span>
      </div>

      {/* Tabs */}
      <div className="px-6 py-2 bg-white border-b flex gap-4">
        {isTechnician && (
          <>
            <button
              onClick={() => setActiveTab("create")}
              className={`pb-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "create"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-slate-500 hover:text-slate-700"
                }`}
            >
              Tạo báo cáo mới
            </button>
            <button
              onClick={() => setActiveTab("history")}
              className={`pb-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "history"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-slate-500 hover:text-slate-700"
                }`}
            >
              Lịch sử báo cáo
            </button>
          </>
        )}
        {isManagerOrAdmin && (
          <button
            onClick={() => setActiveTab("review")}
            className={`pb-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "review"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
          >
            Duyệt báo cáo ({reports.length})
          </button>
        )}
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-auto p-6">

        {/* --- CREATE TAB --- */}
        {activeTab === "create" && (
          <div className="max-w-2xl mx-auto bg-white rounded-xl shadow-sm border p-6">
            <h3 className="text-lg font-semibold mb-6 flex items-center gap-2">
              <Send className="w-5 h-5" />
              Gửi báo cáo công việc
            </h3>

            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">Chọn Công việc (Job) *</label>
                <select
                  className="w-full h-10 px-3 rounded-md border border-slate-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={selectedJobId}
                  onChange={(e) => setSelectedJobId(e.target.value)}
                  required
                >
                  <option value="">-- Chọn công việc --</option>
                  {jobs.map(job => (
                    <option key={job.id} value={job.id}>
                      [{job.job_code}] {job.customers?.company_name} ({job.status})
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">Mô tả sự cố *</label>
                <textarea
                  className="w-full min-h-[100px] px-3 py-2 rounded-md border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Mô tả chi tiết vấn đề gặp phải..."
                  value={problemSummary}
                  onChange={(e) => setProblemSummary(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">Hành động đã xử lý</label>
                <textarea
                  className="w-full min-h-[80px] px-3 py-2 rounded-md border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Các bước bạn đã thực hiện..."
                  value={actionsTaken}
                  onChange={(e) => setActionsTaken(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700 flex items-center gap-2">
                    <ImageIcon className="w-4 h-4" /> Link Ảnh minh chứng
                  </label>
                  <Input
                    placeholder="https://example.com/image.jpg"
                    value={imageUrl}
                    onChange={(e) => setImageUrl(e.target.value)}
                  />
                  <p className="text-[10px] text-slate-400">Nhập URL ảnh (tạm thời)</p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700 flex items-center gap-2">
                    <Mic className="w-4 h-4" /> Link Voice ghi âm
                  </label>
                  <Input
                    placeholder="https://example.com/voice.mp3"
                    value={voiceUrl}
                    onChange={(e) => setVoiceUrl(e.target.value)}
                  />
                </div>
              </div>

              <div className="pt-4">
                <Button type="submit" className="w-full bg-blue-600 hover:bg-blue-700" disabled={isSubmitting}>
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Đang gửi...
                    </>
                  ) : (
                    "Gửi Báo Cáo"
                  )}
                </Button>
              </div>
            </form>
          </div>
        )}

        {/* --- REVIEW/HISTORY TAB --- */}
        {(activeTab === "review" || activeTab === "history") && (
          <div className="space-y-4">
            {isLoading ? (
              <div className="text-center py-12 text-slate-500">
                <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2" />
                Đang tải dữ liệu...
              </div>
            ) : reports.length === 0 ? (
              <div className="text-center py-12 text-slate-500 bg-white rounded-xl border border-dashed">
                <History className="w-8 h-8 mx-auto mb-2 opacity-50" />
                Chưa có báo cáo nào
              </div>
            ) : (
              <div className="grid gap-4">
                {reports.map((report) => (
                  <div key={report.id} className="bg-white rounded-xl border shadow-sm p-4 hover:shadow-md transition-shadow">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <h4 className="font-bold text-slate-800 flex items-center gap-2">
                          Job: {report.jobs.job_code}
                          <span className={`text-xs px-2 py-0.5 rounded-full ${report.jobs.status === 'Ho_n_th_nh'
                            ? 'bg-green-100 text-green-700'
                            : report.jobs.status === 'Ch_duy_t'
                              ? 'bg-yellow-100 text-yellow-700'
                              : 'bg-slate-100 text-slate-600'
                            }`}>
                            {report.jobs.status === 'Ho_n_th_nh' ? 'Đã hoàn thành' :
                              report.jobs.status === 'Ch_duy_t' ? 'Chờ duyệt' : report.jobs.status}
                          </span>
                        </h4>
                        <p className="text-sm font-medium text-slate-600 mt-1">{report.jobs.customers?.company_name}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-slate-500">Tạo bởi: <span className="font-medium text-slate-700">{report.users.full_name}</span></p>
                        <p className="text-xs text-slate-400">{new Date(report.timestamp).toLocaleString()}</p>
                      </div>
                    </div>

                    <div className="grid md:grid-cols-2 gap-4 mb-4 bg-slate-50 p-3 rounded-lg text-sm">
                      <div>
                        <span className="font-medium text-slate-500 block mb-1">Vấn đề:</span>
                        <p className="text-slate-800">{report.problem_summary}</p>
                      </div>
                      <div>
                        <span className="font-medium text-slate-500 block mb-1">Đã xử lý:</span>
                        <p className="text-slate-800">{report.actions_taken || "-"}</p>
                      </div>
                    </div>

                    {/* Attachments */}
                    {(report.image_urls.length > 0 || report.voice_message_url) && (
                      <div className="flex gap-2 mb-4">
                        {report.image_urls.map((img, idx) => (
                          <div key={idx} className="flex items-center gap-1 text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded border border-blue-100">
                            <ImageIcon className="w-3 h-3" /> Ảnh {idx + 1}
                          </div>
                        ))}
                        {report.voice_message_url && (
                          <div className="flex items-center gap-1 text-xs bg-purple-50 text-purple-700 px-2 py-1 rounded border border-purple-100">
                            <Mic className="w-3 h-3" /> Voice
                          </div>
                        )}
                      </div>
                    )}

                    {/* Actions (Only for Review Tab and Pending Jobs) */}
                    {activeTab === "review" && (report.jobs.status === "Ch_duy_t" || report.jobs.status === "Dang_thuc_hien") && (
                      <div className="flex justify-end pt-3 border-t">
                        <Button
                          onClick={() => handleApprove(report.job_id, report.id)}
                          className="bg-green-600 hover:bg-green-700 text-white gap-2"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          Duyệt & Hoàn thành
                        </Button>
                      </div>
                    )}

                    {/* Fix handleApprove argument */}
                    {/* report has `job_id` field? In typescript interface above I missed it.
                        Back end `db.job_reports.findMany` usually returns all scalars.
                        So `report.job_id` should exist.
                    */}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

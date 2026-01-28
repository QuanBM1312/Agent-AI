"use client"

import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Loader2, CheckCircle2, FileText, Mic, Image as ImageIcon, History, Send, X, Square, ChevronLeft, ChevronRight, FolderOpen, ChevronDown, CheckCircle } from "lucide-react"
import { useMediaRecorder } from "@/hooks/use-media-recorder"

interface ReportsPanelProps {
  userRole: string
}

interface Job {
  id: string
  job_code: string
  status: string
  scheduled_start_time: string
  customers: {
    company_name: string
  }
  job_reports?: Report[] 
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
  const [reports, setReports] = useState<Report[]>([]) // Keep for legacy or specific report view if needed, but mainly use jobs.job_reports
  const [isLoading, setIsLoading] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Pagination State
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const limit = 10

  // Media State
  const { isRecording, mediaBlob, startRecording, stopRecording, clearRecording } = useMediaRecorder()
  const [selectedImage, setSelectedImage] = useState<File | null>(null)
  const [expandedJobs, setExpandedJobs] = useState<Record<string, boolean>>({}) // Accordion state
  const imageInputRef = useRef<HTMLInputElement>(null)

  // Form State
  const [selectedJobId, setSelectedJobId] = useState("")
  const [problemSummary, setProblemSummary] = useState("")
  const [actionsTaken, setActionsTaken] = useState("")

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
        setJobs(data.data || [])
      }
    } catch (error) {
      console.error("Failed to fetch jobs", error)
    }
  }, [])

  // Fetch Jobs with Reports (history/review)
  const fetchJobsWithReports = useCallback(async () => {
    setIsLoading(true)
    try {
      // Fetch jobs with reports included
      const res = await fetch(`/api/jobs?page=${page}&limit=${limit}`)
      if (res.ok) {
        const data = await res.json()
        setJobs(data.data || [])
        if (data.pagination) {
          setTotalPages(data.pagination.totalPages)
        }
      }
    } catch (error) {
      console.error("Failed to fetch jobs with reports", error)
    } finally {
      setIsLoading(false)
    }
  }, [page])

  // No longer need reportsByJob optimization since structure is nested in jobs
  // But strictly speaking, the old `reports` state is now unused for history/review tab rendering.
  // We can remove reportsByJob memo.

  useEffect(() => {
    setPage(1)
  }, [activeTab])

  useEffect(() => {
    if (activeTab === "create") fetchJobs()
    if (activeTab === "history" || activeTab === "review") fetchJobsWithReports()
  }, [activeTab, fetchJobs, fetchJobsWithReports, page])

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedImage(e.target.files[0])
    }
  }

  const clearImage = () => {
    setSelectedImage(null)
    if (imageInputRef.current) imageInputRef.current.value = ""
  }

  const uploadFile = async (file: File | Blob): Promise<string> => {
    const formData = new FormData()
    formData.append("file", file)

    // If it's a blob (voice), give it a name
    if (file instanceof Blob && !(file instanceof File)) {
      formData.append("file", file, "voice_report.webm")
    }

    const res = await fetch("/api/upload", {
      method: "POST",
      body: formData
    })

    if (!res.ok) throw new Error("Upload failed")
    const data = await res.json()
    return data.url
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedJobId) return alert("Vui lòng chọn công việc")
    
    // Check if job is completed
    const selectedJob = jobs.find(j => j.id === selectedJobId)
    if (selectedJob && (selectedJob.status === 'Ho_n_t_t___n' || selectedJob.status === 'Hoàn tất đơn')) {
      return alert("Công việc này đã hoàn tất, không thể gửi thêm báo cáo.")
    }

    // Check mandatory media requirement
    if (!selectedImage && !mediaBlob) return alert("Vui lòng đính kèm hình ảnh hoặc ghi âm voice báo cáo")

    setIsSubmitting(true)
    try {
      // 1. Upload Media
      let imageUrl = ""
      let voiceUrl = ""

      if (selectedImage) {
        imageUrl = await uploadFile(selectedImage)
      }

      if (mediaBlob) {
        voiceUrl = await uploadFile(mediaBlob)
      }

      // 2. Submit Report
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
        clearImage()
        clearRecording()
        setSelectedJobId("")
        // Switch to history
        setActiveTab("history")
        // No need to call fetch here as useEffect will trigger on tab change
      } else {
        const err = await res.json()
        alert(`Lỗi: ${err.error}`)
      }
    } catch (error) {
      console.error("Submit error", error)
      alert("Lỗi khi gửi báo cáo: " + (error as Error).message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleApprove = async (jobId: string) => {
    if (!confirm("Bạn có chắc chắn muốn duyệt báo cáo này?")) return

    try {
      const res = await fetch(`/api/jobs/${jobId}/approve`, {
        method: "POST"
      })

      if (res.ok) {
        alert("Đã duyệt báo cáo thành công!")
        alert("Đã duyệt báo cáo thành công!")
        fetchJobsWithReports() // Refresh list
      } else {
        const err = await res.json()
        alert(`Lỗi: ${err.error}`)
      }
    } catch (error) {
      console.error("Approve error", error)
      alert("Lỗi kết nối")
    }
  }

  const handleComplete = async (jobId: string) => {
    if (!confirm("Bạn có chắc chắn muốn HOÀN TẤT ĐƠN này? Hành động này sẽ ghi nhận thời gian kết thúc thực tế.")) return

    try {
      const res = await fetch(`/api/jobs/${jobId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "Hoàn tất đơn" })
      })

      if (res.ok) {
        alert("Hoàn tất đơn hàng thành công!")
        alert("Hoàn tất đơn hàng thành công!")
        fetchJobsWithReports() // Refresh list
      } else {
        const err = await res.json()
        alert(`Lỗi: ${err.error}`)
      }
    } catch (error) {
      console.error("Complete error", error)
      alert("Lỗi kết nối")
    }
  }

  const toggleJobExpand = (jobId: string) => {
    setExpandedJobs(prev => ({
      ...prev,
      [jobId]: !prev[jobId]
    }))
  }

  return (
    <div className="flex flex-col h-full bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b px-6 py-4 flex items-center justify-between">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <FileText className="w-5 h-5 text-blue-600" />
          Quản lý Báo cáo
        </h2>
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
                  {jobs.map(job => {
                    const isCompleted = job.status === 'Ho_n_t_t___n' || job.status === 'Hoàn tất đơn'
                    return (
                      <option key={job.id} value={job.id} disabled={isCompleted}>
                        [{job.job_code}] {job.customers?.company_name} ({job.status}) {isCompleted ? '-- Đã hoàn tất' : ''}
                      </option>
                    )
                  })}
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

              {/* Media Inputs Refactored */}
              <div className="space-y-3">
                <label className="text-sm font-medium text-slate-700">Đính kèm minh chứng (Bắt buộc cần Ảnh hoặc Voice)</label>

                {/* Controls */}
                <div className="flex gap-2">
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    ref={imageInputRef}
                    onChange={handleImageSelect}
                  />

                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => imageInputRef.current?.click()}
                    className="gap-2"
                  >
                    <ImageIcon className="w-4 h-4 text-blue-600" />
                    Tải ảnh
                  </Button>

                  <Button
                    type="button"
                    variant={isRecording ? "destructive" : "outline"}
                    onClick={isRecording ? stopRecording : startRecording}
                    className={`gap-2 ${isRecording ? "animate-pulse" : ""}`}
                  >
                    {isRecording ? <Square className="w-4 h-4" /> : <Mic className="w-4 h-4 text-red-600" />}
                    {isRecording ? "Dừng ghi âm" : "Ghi âm"}
                  </Button>
                </div>

                {/* Previews */}
                <div className="space-y-2">
                  {selectedImage && (
                    <div className="flex items-center gap-3 p-3 bg-muted/30 border rounded-lg">
                      <div className="relative w-16 h-16 rounded overflow-hidden border">
                        <Image
                          src={URL.createObjectURL(selectedImage)}
                          alt="Preview"
                          fill
                          className="object-cover"
                        />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium truncate">{selectedImage.name}</p>
                        <p className="text-xs text-muted-foreground">{(selectedImage.size / 1024).toFixed(1)} KB</p>
                      </div>
                      <Button type="button" variant="ghost" size="icon" onClick={clearImage}>
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  )}

                  {mediaBlob && (
                    <div className="flex items-center gap-3 p-3 bg-muted/30 border rounded-lg">
                      <div className="w-10 h-10 flex items-center justify-center bg-red-100 rounded-full text-red-600">
                        <Mic className="w-5 h-5" />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium">Ghi âm sự cố</p>
                        <audio controls src={URL.createObjectURL(mediaBlob)} className="w-full h-8 mt-1" />
                      </div>
                      <Button type="button" variant="ghost" size="icon" onClick={clearRecording}>
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  )}
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
            ) : (
              <div className="grid gap-6">
                {jobs.map((job) => {
                  const jobReports = job.job_reports || []
                  const isExpanded = expandedJobs[job.id]

                  return (
                    <div key={job.id} className="bg-white rounded-xl border shadow-sm overflow-hidden flex flex-col">
                      {/* Job Folder Header */}
                      <div
                        className={`p-4 flex flex-wrap items-center justify-between gap-4 cursor-pointer transition-colors ${isExpanded ? 'bg-slate-50' : 'hover:bg-slate-50'
                          }`}
                        onClick={() => toggleJobExpand(job.id)}
                      >
                        <div className="flex items-center gap-4">
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isExpanded ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-500'
                            }`}>
                            <FolderOpen className="w-5 h-5" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h4 className="font-bold text-slate-800">Job: {job.job_code}</h4>
                              <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${(job.status === 'Ho_n_th_nh' || job.status === 'Đã duyệt')
                                ? 'bg-green-100 text-green-700'
                                : (job.status === 'Ch_duy_t' || job.status === 'Chờ duyệt')
                                  ? 'bg-amber-100 text-amber-700'
                                  : (job.status === 'Ho_n_t_t___n' || job.status === 'Hoàn tất đơn')
                                    ? 'bg-slate-100 text-slate-600'
                                    : 'bg-blue-100 text-blue-700'
                                }`}>
                                {job.status === 'Ho_n_th_nh' || job.status === 'Đã duyệt' ? 'Đã duyệt' :
                                  job.status === 'Ch_duy_t' || job.status === 'Chờ duyệt' ? 'Chờ duyệt' :
                                    job.status === 'Ho_n_t_t___n' || job.status === 'Hoàn tất đơn' ? 'Hoàn tất đơn' :
                                      job.status === 'ph_n_c_ng' || job.status === 'Đã phân công' ? 'Mới' : job.status}
                              </span>
                            </div>
                            <p className="text-sm font-medium text-slate-600">{job.customers?.company_name}</p>
                            {job.scheduled_start_time && (
                              <p className="text-xs text-slate-400 flex items-center gap-1 mt-1">
                                <span>Bắt đầu: {new Date(job.scheduled_start_time).toLocaleString()}</span>
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          <div className="text-right hidden sm:block">
                            <p className="text-xs font-semibold text-slate-500">{jobReports.length} báo cáo</p>
                            {jobReports.length > 0 && (
                              <p className="text-[10px] text-slate-400">Cập nhật: {new Date(jobReports[0].timestamp).toLocaleDateString()}</p>
                            )}
                          </div>

                          <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                            {/* Actions for Managers/Admins */}
                            {isManagerOrAdmin && activeTab === "review" && (
                              <>
                                {(job.status === "Ch_duy_t" || job.status === "Chờ duyệt") && (
                                  <Button
                                    size="sm"
                                    onClick={() => handleApprove(job.id)}
                                    className="bg-green-600 hover:bg-green-700 text-white gap-2 shadow-sm"
                                  >
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                    Duyệt báo cáo
                                  </Button>
                                )}
                                {(job.status === "Ho_n_th_nh" || job.status === "Đã duyệt") && (
                                  <Button
                                    size="sm"
                                    onClick={() => handleComplete(job.id)}
                                    className="bg-blue-600 hover:bg-blue-700 text-white gap-2 shadow-sm"
                                  >
                                    <CheckCircle className="w-3.5 h-3.5" />
                                    Hoàn tất đơn
                                  </Button>
                                )}
                              </>
                            )}
                            <ChevronDown className={`w-5 h-5 text-slate-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                          </div>
                        </div>
                      </div>

                      {/* Expanded Reports Area */}
                      {isExpanded && (
                        <div className="border-t bg-slate-50/50 p-4 space-y-4 animate-in slide-in-from-top-2 duration-200">
                          {jobReports.length === 0 ? (
                            <div className="text-center py-8 text-slate-400">
                                <FileText className="w-12 h-12 mx-auto mb-2 opacity-50" />
                                <p>Chưa có báo cáo nào cho công việc này.</p>
                            </div>
                          ) : (
                            jobReports.map((report: Report) => (
                              <div key={report.id} className="bg-white rounded-lg border shadow-sm p-4">
                                <div className="flex justify-between items-start mb-3 pb-2 border-b border-slate-100">
                                  <div>
                                    <p className="text-xs text-slate-500">Người báo cáo: <span className="font-semibold text-slate-700">{report.users.full_name}</span></p>
                                    <p className="text-[10px] text-slate-400">{new Date(report.timestamp).toLocaleString()}</p>
                                  </div>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4 text-sm">
                                  <div>
                                    <span className="text-[10px] font-bold uppercase text-slate-400 block mb-1">Vấn đề:</span>
                                    <p className="text-slate-800 leading-relaxed">{report.problem_summary}</p>
                                  </div>
                                  <div>
                                    <span className="text-[10px] font-bold uppercase text-slate-400 block mb-1">Đã xử lý:</span>
                                    <p className="text-slate-800 leading-relaxed">{report.actions_taken || "-"}</p>
                                  </div>
                                </div>

                                {/* Attachments */}
                                {(report.image_urls.length > 0 || report.voice_message_url) && (
                                  <div className="flex gap-2 flex-wrap pt-2">
                                    {report.image_urls.map((img: string, idx: number) => (
                                      <a key={idx} href={img} target="_blank" rel="noopener noreferrer" className="relative group block w-16 h-16 rounded-md border overflow-hidden hover:ring-2 hover:ring-blue-500 transition-all">
                                        <Image src={img} alt="Evidence" width={64} height={64} className="w-full h-full object-cover" />
                                        <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                          <ImageIcon className="w-4 h-4 text-white" />
                                        </div>
                                      </a>
                                    ))}
                                    {report.voice_message_url && (
                                      <div className="flex items-center gap-2 text-xs bg-purple-50 text-purple-700 px-3 py-1.5 rounded-full border border-purple-100 hover:bg-purple-100 transition-colors cursor-pointer self-end">
                                        <Mic className="w-3.5 h-3.5" />
                                        <a href={report.voice_message_url} target="_blank" rel="noreferrer" className="font-semibold uppercase tracking-tighter">Voice Memo</a>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}

                {/* Pagination Controls */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between px-2 py-4 border-t mt-4">
                    <p className="text-sm text-slate-500">
                      Trang {page} / {totalPages}
                    </p>
                    <div className="flex gap-2">
                       {/* Pagination buttons logic remains same, just ensure it affects the 'jobs' fetch via page state */}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage(p => Math.max(1, p - 1))}
                        disabled={page === 1 || isLoading}
                        className="h-8"
                      >
                        <ChevronLeft className="w-4 h-4 mr-1" /> Trước
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                        disabled={page === totalPages || isLoading}
                        className="h-8"
                      >
                        Sau <ChevronRight className="w-4 h-4 ml-1" />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Plus, Folder, Calendar, Hammer, Package, Hash, ChevronDown, ChevronRight, Info, Users } from "lucide-react"
import { ProjectForm } from "./project-form"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"

interface ProjectSerial {
  id: string
  serial_number: string
}

interface ProjectItem {
  id: string
  model_name: string
  quantity: number
  warranty_start_date?: string
  warranty_end_date?: string
  project_serials: ProjectSerial[]
}

interface Project {
  id: string
  name: string
  address: string | null
  contact_person: string | null
  contact_position: string | null
  input_contract_no: string | null
  input_contract_date: string | null
  output_contract_no: string | null
  output_contract_date: string | null
  created_at: string
  project_items: any[]
  project_personnel?: any[]
}

interface ProjectListProps {
  customerId: string
  userRole: string
}

export function ProjectList({ customerId, userRole }: ProjectListProps) {
  const [projects, setProjects] = useState<Project[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({})
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [editingProject, setEditingProject] = useState<Project | null>(null)
  const [showEditModal, setShowEditModal] = useState(false)

  const canManage = ["Admin", "Manager", "Sales"].includes(userRole)

  const fetchProjects = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await fetch(`/api/projects?customer_id=${customerId}`)
      if (res.ok) {
        const data = await res.json()
        setProjects(data)
      }
    } catch (error) {
      console.error("Failed to fetch projects", error)
    } finally {
      setIsLoading(false)
    }
  }, [customerId])

  useEffect(() => {
    fetchProjects()
  }, [fetchProjects])

  const toggleExpand = (projectId: string) => {
    setExpandedProjects(prev => ({
      ...prev,
      [projectId]: !prev[projectId]
    }))
  }

  const formatDate = (dateString?: string) => {
    if (!dateString) return "N/A"
    return new Date(dateString).toLocaleDateString("vi-VN")
  }

  if (isLoading) {
    return <div className="p-4 text-center text-muted-foreground italic text-sm">Đang tải danh sách dự án...</div>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between border-b pb-2">
        <h3 className="text-md font-semibold flex items-center gap-2">
          <Folder className="w-4 h-4 text-primary" />
          Danh sách Dự án
        </h3>
        {canManage && (
          <Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" className="h-8 gap-1 text-xs">
                <Plus className="w-3.5 h-3.5" />
                Mở dự án mới
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Thêm dự án mới cho khách hàng</DialogTitle>
              </DialogHeader>
              <ProjectForm
                customerId={customerId}
                onSuccess={() => {
                  setShowCreateModal(false)
                  fetchProjects()
                }}
              />
            </DialogContent>
          </Dialog>
        )}
      </div>

      {projects.length === 0 ? (
        <div className="text-center py-8 bg-muted/20 rounded-lg border border-dashed">
          <p className="text-sm text-muted-foreground">Khách hàng chưa có dự án nào.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {projects.map(project => (
            <div key={project.id} className="border rounded-lg overflow-hidden bg-card">
              {/* Project Header */}
              <div
                className="flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => toggleExpand(project.id)}
              >
                {expandedProjects[project.id] ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                <div className="flex-1">
                  <div className="font-medium text-sm">{project.name}</div>
                  <div className="text-xs text-muted-foreground flex items-center gap-3 mt-1">
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {formatDate(project.created_at)}
                    </span>
                    {project.address && (
                      <span className="flex items-center gap-1 truncate max-w-[200px]">
                        <Hammer className="w-3 h-3" />
                        {project.address}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {canManage && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0"
                      onClick={(e) => {
                        e.stopPropagation()
                        setEditingProject(project)
                        setShowEditModal(true)
                      }}
                    >
                      <Info className="w-3.5 h-3.5 text-muted-foreground hover:text-primary" />
                    </Button>
                  )}
                  <div className="text-xs font-semibold px-2 py-0.5 bg-primary/10 text-primary rounded">
                    {project.project_items.length} hạng mục
                  </div>
                </div>
              </div>

              {/* Project Details (Expanded) */}
              {expandedProjects[project.id] && (
                <div className="p-4 border-t bg-muted/10 space-y-4 animate-in slide-in-from-top-1">
                  {/* Sub-info */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                    <div className="space-y-1">
                      <span className="text-muted-foreground">HĐ Đầu vào:</span>
                      <div className="font-medium">{project.input_contract_no || "N/A"}</div>
                      <div className="text-[10px]">{formatDate(project.input_contract_date)}</div>
                    </div>
                    <div className="space-y-1">
                      <span className="text-muted-foreground">HĐ Đầu ra:</span>
                      <div className="font-medium">{project.output_contract_no || "N/A"}</div>
                      <div className="text-[10px]">{formatDate(project.output_contract_date)}</div>
                    </div>
                    <div className="space-y-1">
                      <span className="text-muted-foreground">Người liên hệ:</span>
                      <div className="font-medium">{project.contact_person || "N/A"}</div>
                      <div className="text-[10px]">{project.contact_position}</div>
                    </div>
                    <div className="space-y-1">
                      <span className="text-muted-foreground">Địa chỉ dự án:</span>
                      <div className="font-medium line-clamp-2">{project.address || "N/A"}</div>
                    </div>
                  </div>

                  {/* Personnel Section */}
                  {project.project_personnel && project.project_personnel.length > 0 && (
                    <div className="space-y-2 pt-2 border-t">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                        <Users className="w-3 h-3" />
                        Nhân sự thực hiện
                      </h4>
                      <div className="flex flex-wrap gap-2">
                        {project.project_personnel.map((p: any) => (
                          <div key={p.user_id} className="flex items-center gap-1.5 px-2 py-1 bg-background border rounded-md text-[10px]">
                            <span className="font-semibold text-primary">{p.users?.full_name}</span>
                            <span className="text-muted-foreground">({p.users?.role})</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Equipment List */}
                  <div className="space-y-2 pt-2 border-t">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                      <Package className="w-3 h-3" />
                      Danh sách thiết bị
                    </h4>
                    <div className="grid gap-2">
                      {project.project_items.map(item => (
                        <div key={item.id} className="bg-background border rounded p-3 space-y-2">
                          <div className="flex justify-between items-start">
                            <div>
                              <div className="text-sm font-semibold">{item.model_name}</div>
                              <div className="text-[10px] text-muted-foreground flex items-center gap-2 mt-0.5">
                                <span>BH: {formatDate(item.warranty_start_date)} - {formatDate(item.warranty_end_date)}</span>
                              </div>
                            </div>
                            <div className="text-xs px-1.5 py-0.5 border rounded bg-muted/50">
                              SL: {item.quantity}
                            </div>
                          </div>

                          {/* Serials */}
                          <div className="flex flex-wrap gap-1.5">
                            {item.project_serials.map(sn => (
                              <div key={sn.id} className="flex items-center gap-1 px-1.5 py-0.5 bg-muted rounded text-[10px] border">
                                <Hash className="w-2.5 h-2.5 text-muted-foreground" />
                                {sn.serial_number}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Edit Project Dialog */}
      <Dialog open={showEditModal} onOpenChange={setShowEditModal}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Chỉnh sửa thông tin dự án</DialogTitle>
          </DialogHeader>
          {editingProject && (
            <ProjectForm
              customerId={customerId}
              initialData={editingProject}
              onSuccess={() => {
                setShowEditModal(false)
                setEditingProject(null)
                fetchProjects()
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

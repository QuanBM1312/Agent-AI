"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Search, Loader2, UserCog, Pencil, Trash2, ChevronLeft, ChevronRight } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"

interface User {
    id: string
    full_name: string
    email: string
    role: string
    department_id: string | null
    departments?: {
        name: string
    }
}

interface Department {
    id: string
    name: string
}

export function UsersPanel({ userRole }: { userRole: string }) {
    const [users, setUsers] = useState<User[]>([])
    const [departments, setDepartments] = useState<Department[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [searchQuery, setSearchQuery] = useState("")

    // Pagination & Search State
    const [page, setPage] = useState(1)
    const [totalPages, setTotalPages] = useState(1)
    const [debouncedSearch, setDebouncedSearch] = useState("")
    const limit = 20

    // Edit State
    const [editingUser, setEditingUser] = useState<User | null>(null)
    const [isSaving, setIsSaving] = useState(false)

    // Permission Check
    const isAdmin = userRole === 'Admin'

    const fetchData = useCallback(async () => {
        if (!isAdmin) return
        setIsLoading(true)
        try {
            const params = new URLSearchParams()
            if (debouncedSearch) params.append("search", debouncedSearch)
            params.append("page", page.toString())
            params.append("limit", limit.toString())

            const [uRes, dRes] = await Promise.all([
                fetch(`/api/users?${params.toString()}`),
                fetch('/api/departments')
            ])

            if (uRes.ok) {
                const uData = await uRes.json()
                setUsers(uData.data || [])
                if (uData.pagination) {
                    setTotalPages(uData.pagination.totalPages)
                }
            }
            if (dRes.ok) {
                const dData = await dRes.json()
                setDepartments(dData)
            }

        } catch (error) {
            console.error("Failed to load data", error)
        } finally {
            setIsLoading(false)
        }
    }, [isAdmin, debouncedSearch, page, limit])

    // Debounce search
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearch(searchQuery)
            setPage(1)
        }, 500)
        return () => clearTimeout(timer)
    }, [searchQuery])

    useEffect(() => {
        fetchData()
    }, [fetchData]) // Initial load and on change

    // Filter logic moved to server-side, but keep the variable for compatibility if needed elsewhere
    const filteredUsers = users

    const handleUpdateUser = async () => {
        if (!editingUser) return
        setIsSaving(true)
        try {
            const res = await fetch('/api/users', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: editingUser.id,
                    role: editingUser.role,
                    department_id: editingUser.department_id
                })
            })

            if (!res.ok) throw new Error("Failed to update")

            // Update local state
            setUsers(users.map(u => u.id === editingUser.id ? {
                ...u,
                role: editingUser.role,
                department_id: editingUser.department_id,
                departments: departments.find(d => d.id === editingUser.department_id) ? { name: departments.find(d => d.id === editingUser.department_id)!.name } : undefined
            } : u))

            setEditingUser(null)
            alert("Cập nhật thành công")
        } catch {
            alert("Lỗi khi cập nhật")
        } finally {
            setIsSaving(false)
        }
    }

    const handleDeleteUser = async (id: string) => {
        if (!confirm("Bạn có chắc chắn muốn xóa user này không?")) return

        try {
            const res = await fetch(`/api/users?id=${id}`, { method: 'DELETE' })
            if (res.ok) {
                setUsers(users.filter(u => u.id !== id))
            } else {
                alert("Không thể xóa user")
            }
        } catch {
            alert("Lỗi khi xóa")
        }
    }

    if (!isAdmin) {
        return (
            <div className="flex h-full items-center justify-center text-muted-foreground">
                Bạn không có quyền truy cập trang này.
            </div>
        )
    }

    return (
        <div className="flex flex-col h-full bg-background">
            {/* Header */}
            <div className="border-b border-border p-3 md:p-6">
                <h2 className="text-xl md:text-2xl font-bold text-foreground flex items-center gap-2">
                    <UserCog className="w-6 h-6 text-primary" />
                    Quản lý Nhân sự
                </h2>
                <p className="text-xs md:text-sm text-muted-foreground mt-1">
                    Quản lý tài khoản, phân quyền và phòng ban
                </p>
            </div>

            {/* Content */}
            <div className="flex-1 p-4 md:p-6 overflow-hidden flex flex-col">
                {/* Search */}
                <div className="mb-4 relative max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                        placeholder="Tìm tên hoặc email..."
                        className="pl-9"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>

                {/* Table */}
                <div className="flex-1 overflow-auto border rounded-md bg-card">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-muted text-muted-foreground font-medium sticky top-0 z-10">
                            <tr>
                                <th className="p-3">Họ tên</th>
                                <th className="p-3">Email</th>
                                <th className="p-3">Vai trò</th>
                                <th className="p-3">Phòng ban</th>
                                <th className="p-3 text-right">Thao tác</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {isLoading ? (
                                <tr><td colSpan={5} className="p-8 text-center text-muted-foreground">Đang tải...</td></tr>
                            ) : filteredUsers.map(u => (
                                <tr key={u.id} className="hover:bg-muted/50 transition-colors">
                                    <td className="p-3 font-medium">{u.full_name}</td>
                                    <td className="p-3 text-muted-foreground">{u.email}</td>
                                    <td className="p-3">
                                        <span className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-medium border ${u.role === 'Admin' ? 'bg-red-100 text-red-800 border-red-200' :
                                            u.role === 'Manager' ? 'bg-purple-100 text-purple-800 border-purple-200' :
                                                u.role === 'Sales' ? 'bg-blue-100 text-blue-800 border-blue-200' :
                                                    'bg-slate-100 text-slate-800 border-slate-200'
                                            }`}>
                                            {u.role}
                                        </span>
                                    </td>
                                    <td className="p-3 text-muted-foreground">
                                        {u.departments?.name || '-'}
                                    </td>
                                    <td className="p-3 text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            <Button variant="ghost" size="sm" onClick={() => setEditingUser(u)}>
                                                <Pencil className="w-4 h-4 text-blue-500" />
                                            </Button>
                                            <Button variant="ghost" size="sm" onClick={() => handleDeleteUser(u.id)}>
                                                <Trash2 className="w-4 h-4 text-red-500" />
                                            </Button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {/* Pagination Controls */}
                {totalPages > 1 && (
                    <div className="flex items-center justify-between px-2 py-4 border-t mt-auto">
                        <p className="text-sm text-muted-foreground">
                            Trang {page} / {totalPages}
                        </p>
                        <div className="flex gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setPage(p => Math.max(1, p - 1))}
                                disabled={page === 1 || isLoading}
                            >
                                <ChevronLeft className="w-4 h-4 mr-1" /> Trước
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                                disabled={page === totalPages || isLoading}
                            >
                                Sau <ChevronRight className="w-4 h-4 ml-1" />
                            </Button>
                        </div>
                    </div>
                )}
            </div>

            {/* Edit Dialog */}
            {editingUser && (
                <Dialog open={!!editingUser} onOpenChange={(open) => !open && setEditingUser(null)}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Cập nhật nhân viên</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4 py-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Họ tên</label>
                                <Input value={editingUser.full_name} disabled className="bg-muted" />
                            </div>

                            <div className="space-y-2">
                                <label className="text-sm font-medium">Vai trò <span className="text-red-500">*</span></label>
                                <div className="grid grid-cols-2 gap-2">
                                    {['Admin', 'Manager', 'Sales', 'Technician'].map(role => (
                                        <div
                                            key={role}
                                            className={`cursor-pointer border rounded-md p-3 text-center text-sm transition-all ${editingUser.role === role ? 'border-primary bg-primary/5 font-bold text-primary' : 'hover:bg-muted'
                                                }`}
                                            onClick={() => setEditingUser({ ...editingUser, role })}
                                        >
                                            {role}
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="text-sm font-medium">Phòng ban</label>
                                <select
                                    className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
                                    value={editingUser.department_id || ''}
                                    onChange={(e) => setEditingUser({ ...editingUser, department_id: e.target.value || null })}
                                >
                                    <option value="">-- Không trực thuộc --</option>
                                    {departments.map(d => (
                                        <option key={d.id} value={d.id}>{d.name}</option>
                                    ))}
                                </select>
                                <p className="text-xs text-muted-foreground">Manager và Technician nên thuộc về một phòng ban cụ thể.</p>
                            </div>
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setEditingUser(null)}>Hủy</Button>
                            <Button onClick={handleUpdateUser} disabled={isSaving}>
                                {isSaving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                                Lưu thay đổi
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            )}
        </div>
    )
}

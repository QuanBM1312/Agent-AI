"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Search, Loader2, Plus, Building2, User } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"

interface Customer {
    id: string
    company_name: string
    contact_person: string
    phone: string
    address: string
    customer_type: string
}

interface CustomersPanelProps {
    userRole: string
}

export function CustomersPanel({ userRole }: CustomersPanelProps) {
    const [customers, setCustomers] = useState<Customer[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [searchQuery, setSearchQuery] = useState("")
    const [showCreateModal, setShowCreateModal] = useState(false)

    // Create Form State
    const [newItem, setNewItem] = useState({
        company_name: '',
        contact_person: '',
        phone: '',
        address: '',
        customer_type: 'Cá nhân'
    })
    const [isSubmitting, setIsSubmitting] = useState(false)

    // Permissions
    const canViewList = ["Admin", "Manager"].includes(userRole)
    const canCreate = ["Admin", "Manager", "Sales"].includes(userRole)

    const fetchCustomers = async () => {
        if (!canViewList) return

        setIsLoading(true)
        try {
            const params = new URLSearchParams()
            if (searchQuery) params.append("search", searchQuery)

            const res = await fetch(`/api/customers?${params.toString()}`)
            if (res.ok) {
                const data = await res.json()
                setCustomers(data.customers || [])
            } else {
                // Handle 403 or other errors gracefully
                setCustomers([])
            }
        } catch (error) {
            console.error("Failed to fetch customers", error)
        } finally {
            setIsLoading(false)
        }
    }

    useEffect(() => {
        fetchCustomers()
    }, [searchQuery, userRole]) // Re-fetch when search or role changes

    const handleCreate = async () => {
        if (!newItem.company_name) {
            alert("Vui lòng nhập tên khách hàng/công ty")
            return
        }

        setIsSubmitting(true)
        try {
            const res = await fetch("/api/customers", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(newItem)
            })

            if (!res.ok) {
                const err = await res.json()
                throw new Error(err.error || "Failed to create")
            }

            alert("Thêm khách hàng thành công!")
            setShowCreateModal(false)
            setNewItem({
                company_name: '',
                contact_person: '',
                phone: '',
                address: '',
                customer_type: 'Cá nhân'
            })

            // Refresh list if user can view it
            if (canViewList) {
                fetchCustomers()
            }

        } catch (error: any) {
            alert(`Lỗi: ${error.message}`)
        } finally {
            setIsSubmitting(false)
        }
    }

    return (
        <div className="h-full flex flex-col bg-background">
            {/* Header */}
            <header className="h-14 border-b border-border flex items-center justify-between px-4 bg-card">
                <h2 className="font-semibold text-lg flex items-center gap-2">
                    <User className="w-5 h-5 text-primary" />
                    Quản lý Khách hàng
                </h2>

                {canCreate && (
                    <Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
                        <DialogTrigger asChild>
                            <Button size="sm" className="gap-2">
                                <Plus className="w-4 h-4" />
                                Thêm khách hàng
                            </Button>
                        </DialogTrigger>
                        <DialogContent>
                            <DialogHeader>
                                <DialogTitle>Thêm khách hàng mới</DialogTitle>
                            </DialogHeader>
                            <div className="space-y-4 py-4">
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">Tên Công ty / Khách hàng <span className="text-red-500">*</span></label>
                                    <Input
                                        value={newItem.company_name}
                                        onChange={(e) => setNewItem({ ...newItem, company_name: e.target.value })}
                                        placeholder="Nhập tên..."
                                    />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium">Người liên hệ</label>
                                        <Input
                                            value={newItem.contact_person}
                                            onChange={(e) => setNewItem({ ...newItem, contact_person: e.target.value })}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium">Số điện thoại</label>
                                        <Input
                                            value={newItem.phone}
                                            onChange={(e) => setNewItem({ ...newItem, phone: e.target.value })}
                                        />
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">Địa chỉ</label>
                                    <Input
                                        value={newItem.address}
                                        onChange={(e) => setNewItem({ ...newItem, address: e.target.value })}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">Loại khách hàng</label>
                                    <select
                                        className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
                                        value={newItem.customer_type}
                                        onChange={(e) => setNewItem({ ...newItem, customer_type: e.target.value })}
                                    >
                                        <option value="Cá nhân">Cá nhân</option>
                                        <option value="Doanh nghiệp">Doanh nghiệp</option>
                                    </select>
                                </div>
                                <Button className="w-full mt-2" onClick={handleCreate} disabled={isSubmitting}>
                                    {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Tạo khách hàng"}
                                </Button>
                            </div>
                        </DialogContent>
                    </Dialog>
                )}
            </header>

            {/* Content */}
            <div className="flex-1 p-4 overflow-hidden flex flex-col">
                <>
                    {/* Search Bar for Admin/Manager */}
                    <div className="mb-4 relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input
                            placeholder="Tìm kiếm khách hàng..."
                            className="pl-9"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>

                    {/* Table */}
                    <div className="flex-1 overflow-auto border rounded-md bg-card">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-muted text-muted-foreground font-medium sticky top-0">
                                <tr>
                                    <th className="p-3">Tên khách hàng</th>
                                    <th className="p-3">Người liên hệ</th>
                                    <th className="p-3">SĐT</th>
                                    <th className="p-3 hidden md:table-cell">Địa chỉ</th>
                                    <th className="p-3 w-24">Loại</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {isLoading ? (
                                    <tr>
                                        <td colSpan={5} className="p-8 text-center text-muted-foreground">
                                            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                                            Đang tải dữ liệu...
                                        </td>
                                    </tr>
                                ) : customers.length === 0 ? (
                                    <tr>
                                        <td colSpan={5} className="p-8 text-center text-muted-foreground">
                                            Không tìm thấy khách hàng nào.
                                        </td>
                                    </tr>
                                ) : (
                                    customers.map((c) => (
                                        <tr key={c.id} className="hover:bg-muted/50 transition-colors">
                                            <td className="p-3 font-medium">{c.company_name}</td>
                                            <td className="p-3">{c.contact_person || "-"}</td>
                                            <td className="p-3">{c.phone || "-"}</td>
                                            <td className="p-3 hidden md:table-cell truncate max-w-xs">{c.address || "-"}</td>
                                            <td className="p-3">
                                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${(c.customer_type === 'Doanh nghiệp' || c.customer_type === 'Doanh_nghi_p')
                                                    ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
                                                    : 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                                                    }`}>
                                                    {c.customer_type === 'Doanh_nghi_p' ? 'Doanh nghiệp' :
                                                        c.customer_type === 'C__nh_n' ? 'Cá nhân' :
                                                            c.customer_type || 'N/A'}
                                                </span>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </>
            </div>
        </div>
    )
}

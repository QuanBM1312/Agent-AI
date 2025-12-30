"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Search, Loader2, Plus, User, ChevronLeft, ChevronRight, Building, Phone, MapPin, Briefcase } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { ContactList } from "./contact-list"
import { ProjectList } from "./projects/project-list"

interface Contact {
    id: string
    name: string
    title?: string
    phone?: string
    email?: string
    is_primary: boolean
}

interface Customer {
    id: string
    company_name: string
    contact_person: string
    phone: string
    address: string
    customer_type: string
    contacts: Contact[]
}

interface CustomersPanelProps {
    userRole: string
}

export function CustomersPanel({ userRole }: CustomersPanelProps) {
    const [customers, setCustomers] = useState<Customer[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [searchQuery, setSearchQuery] = useState("")
    const [showCreateModal, setShowCreateModal] = useState(false)

    // Details Modal State
    const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
    const [showDetailsModal, setShowDetailsModal] = useState(false)

    // Pagination & Search State
    const [page, setPage] = useState(1)
    const [totalPages, setTotalPages] = useState(1)
    const [debouncedSearch, setDebouncedSearch] = useState("")
    const limit = 20

    // Create Form State
    const [newItem, setNewItem] = useState({
        company_name: '',
        contact_person: '',
        contact_title: '',
        phone: '',
        address: '',
        customer_type: 'C__nh_n'
    })
    const [isSubmitting, setIsSubmitting] = useState(false)

    // Permissions
    const canViewList = ["Admin", "Manager"].includes(userRole)
    const canCreate = ["Admin", "Manager", "Sales"].includes(userRole)

    const fetchCustomers = useCallback(async () => {
        if (!canViewList) return

        setIsLoading(true)
        try {
            const params = new URLSearchParams()
            if (debouncedSearch) params.append("search", debouncedSearch)
            params.append("page", page.toString())
            params.append("limit", limit.toString())

            const res = await fetch(`/api/customers?${params.toString()}`)
            if (res.ok) {
                const data = await res.json()
                setCustomers(data.data || [])
                if (data.pagination) {
                    setTotalPages(data.pagination.totalPages)
                }
            } else {
                setCustomers([])
            }
        } catch (error) {
            console.error("Failed to fetch customers", error)
        } finally {
            setIsLoading(false)
        }
    }, [canViewList, debouncedSearch, page, limit])

    // Debounce search
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearch(searchQuery)
            setPage(1)
        }, 500)
        return () => clearTimeout(timer)
    }, [searchQuery])

    useEffect(() => {
        fetchCustomers()
    }, [fetchCustomers, userRole])

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
                contact_title: '',
                phone: '',
                address: '',
                customer_type: 'C__nh_n'
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

    const handleCustomerClick = async (customer: Customer) => {
        // If we already have contacts loaded via fetchCustomers (since we included them in API), simpler.
        // If not, we might need to fetch them.
        // Based on my API change, contacts ARE included.
        setSelectedCustomer(customer)
        setShowDetailsModal(true)
    }

    const refreshSelectedCustomer = async () => {
        if (!selectedCustomer) return
        // Re-fetch specific customer or just re-fetch all
        // Since we don't have a single customer fetch for details easily without filtering, 
        // we can just re-fetch the list, but that might close the modal if we are not careful with state references.
        // However, if we just call fetchCustomers, the list updates. We need to update selectedCustomer too.

        // Better strategy: fetch just contacts for this customer or find from list
        await fetchCustomers()
        // We rely on the list update. But we need to update selectedCustomer from the new list.
        // Efficiently, we should have a `fetchCustomerDetails` or just update the contacts list in the local state.
        // For now, let's close and reopen or just assume fetchCustomers updates the list that we might find from.
        // Actually, `selectedCustomer` is a separate object state. Updating `customers` won't update `selectedCustomer`.
        // I should create a small helper to refresh the selected customer's contacts.

        try {
            const res = await fetch(`/api/contacts?customer_id=${selectedCustomer.id}`)
            if (res.ok) {
                const data = await res.json()
                setSelectedCustomer(prev => prev ? { ...prev, contacts: data.data } : null)

                // Also update the main list so it reflects changes without refresh if possible, but simplicity first.
                setCustomers(prev => prev.map(c => c.id === selectedCustomer.id ? { ...c, contacts: data.data } : c))
            }
        } catch (e) {
            console.error(e)
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
                                <span className="hidden sm:inline">Thêm khách hàng</span>
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
                                        <label className="text-sm font-medium">Người liên hệ chính</label>
                                        <Input
                                            value={newItem.contact_person}
                                            onChange={(e) => setNewItem({ ...newItem, contact_person: e.target.value })}
                                            placeholder="Họ tên..."
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium">Chức danh</label>
                                        <Input
                                            value={newItem.contact_title}
                                            onChange={(e) => setNewItem({ ...newItem, contact_title: e.target.value })}
                                            placeholder="VD: Giám đốc"
                                        />
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">Số điện thoại</label>
                                    <Input
                                        value={newItem.phone}
                                        onChange={(e) => setNewItem({ ...newItem, phone: e.target.value })}
                                    />
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
                                        <option value="C__nh_n">Cá nhân</option>
                                        <option value="Doanh_nghi_p">Doanh nghiệp</option>
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
                                        <tr
                                            key={c.id}
                                            className="hover:bg-muted/50 transition-colors cursor-pointer"
                                            onClick={() => handleCustomerClick(c)}
                                        >
                                            <td className="p-3 font-medium">{c.company_name}</td>
                                            <td className="p-3">
                                                <div className="flex flex-col">
                                                    {/* Show primary contact or fallback to legacy field */}
                                                    <span>{c.contacts?.find(cnt => cnt.is_primary)?.name || c.contact_person || "-"}</span>
                                                    {c.contacts?.find(cnt => cnt.is_primary)?.title && (
                                                        <span className="text-xs text-muted-foreground">{c.contacts.find(cnt => cnt.is_primary)?.title}</span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="p-3">{c.contacts?.find(cnt => cnt.is_primary)?.phone || c.phone || "-"}</td>
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
                </>
            </div>

            {/* Customer Details Dialog */}
            <Dialog open={showDetailsModal} onOpenChange={setShowDetailsModal}>
                <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Building className="w-5 h-5 text-primary" />
                            {selectedCustomer?.company_name}
                        </DialogTitle>
                    </DialogHeader>

                    {selectedCustomer && (
                        <div className="space-y-6 pt-4">
                            {/* Basic Info */}
                            <div className="grid md:grid-cols-2 gap-4 p-4 bg-muted/30 rounded-lg border">
                                <div className="space-y-3">
                                    <div className="flex items-start gap-2">
                                        <MapPin className="w-4 h-4 text-muted-foreground mt-0.5" />
                                        <span className="text-sm">{selectedCustomer.address || "Chưa cập nhật địa chỉ"}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs bg-muted px-2 py-1 rounded border">
                                            {selectedCustomer.customer_type === 'Doanh_nghi_p' ? 'Doanh nghiệp' : 'Cá nhân'}
                                        </span>
                                    </div>
                                </div>
                                <div className="space-y-1">
                                    {/* Legacy info display if needed, but we focus on contacts now */}
                                    <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Thông tin chính</p>
                                    <div className="text-sm font-medium">{selectedCustomer.contact_person}</div>
                                    <div className="text-sm text-muted-foreground">{selectedCustomer.phone}</div>
                                </div>
                            </div>

                            {/* Contacts Management */}
                            <ContactList
                                customerId={selectedCustomer.id}
                                contacts={selectedCustomer.contacts || []}
                                onUpdate={refreshSelectedCustomer}
                                userRole={userRole}
                            />

                            {/* Project Management */}
                            <div className="border-t pt-6">
                                <ProjectList
                                    customerId={selectedCustomer.id}
                                    userRole={userRole}
                                />
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    )
}

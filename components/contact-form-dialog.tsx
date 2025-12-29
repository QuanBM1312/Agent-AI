"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Loader2 } from "lucide-react"

interface Contact {
    id?: string
    name: string
    title?: string
    phone?: string
    email?: string
    is_primary: boolean
}

interface ContactFormDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    contact?: Contact | null
    customerId: string
    onSuccess: () => void
}

export function ContactFormDialog({ open, onOpenChange, contact, customerId, onSuccess }: ContactFormDialogProps) {
    const [isLoading, setIsLoading] = useState(false)
    const [formData, setFormData] = useState<Contact>({
        name: "",
        title: "",
        phone: "",
        email: "",
        is_primary: false
    })

    useEffect(() => {
        if (contact) {
            setFormData({
                name: contact.name,
                title: contact.title || "",
                phone: contact.phone || "",
                email: contact.email || "",
                is_primary: contact.is_primary
            })
        } else {
            setFormData({
                name: "",
                title: "",
                phone: "",
                email: "",
                is_primary: false
            })
        }
    }, [contact, open])

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setIsLoading(true)

        try {
            const url = contact?.id
                ? `/api/contacts/${contact.id}`
                : "/api/contacts"

            const method = contact?.id ? "PUT" : "POST"

            const res = await fetch(url, {
                method,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    ...formData,
                    customer_id: customerId
                })
            })

            if (!res.ok) {
                const err = await res.json()
                throw new Error(err.error || "Failed to save contact")
            }

            onSuccess()
            onOpenChange(false)
        } catch (error: any) {
            alert(error.message)
        } finally {
            setIsLoading(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>{contact ? "Chỉnh sửa liên hệ" : "Thêm liên hệ mới"}</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4 py-4">
                    <div className="space-y-2">
                        <label htmlFor="name" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                            Họ và tên *
                        </label>
                        <Input
                            id="name"
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            required
                        />
                    </div>

                    <div className="space-y-2">
                        <label htmlFor="title" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                            Chức danh
                        </label>
                        <Input
                            id="title"
                            placeholder="VD: Trưởng phòng, Giám đốc..."
                            value={formData.title || ""}
                            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label htmlFor="phone" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                                Số điện thoại
                            </label>
                            <Input
                                id="phone"
                                value={formData.phone || ""}
                                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <label htmlFor="email" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                                Email
                            </label>
                            <Input
                                id="email"
                                type="email"
                                value={formData.email || ""}
                                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                            />
                        </div>
                    </div>

                    <div className="flex items-center space-x-2 pt-2">
                        <input
                            type="checkbox"
                            id="is_primary"
                            className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                            checked={formData.is_primary}
                            onChange={(e) => setFormData({ ...formData, is_primary: e.target.checked })}
                        />
                        <label htmlFor="is_primary" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer">
                            Đặt làm người liên hệ chính
                        </label>
                    </div>

                    <DialogFooter className="pt-4">
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                            Hủy
                        </Button>
                        <Button type="submit" disabled={isLoading}>
                            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {contact ? "Cập nhật" : "Thêm mới"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}

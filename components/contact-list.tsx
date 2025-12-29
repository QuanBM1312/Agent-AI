"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Plus, User, Phone, Mail, Star, Edit, Trash2, Briefcase } from "lucide-react"
import { ContactFormDialog } from "./contact-form-dialog"

interface Contact {
    id: string
    name: string
    title?: string
    phone?: string
    email?: string
    is_primary: boolean
}

interface ContactListProps {
    customerId: string
    contacts: Contact[]
    onUpdate: () => void
    userRole: string
}

export function ContactList({ customerId, contacts, onUpdate, userRole }: ContactListProps) {
    const [showForm, setShowForm] = useState(false)
    const [editingContact, setEditingContact] = useState<Contact | null>(null)
    const [isDeleting, setIsDeleting] = useState<string | null>(null)

    const canEdit = ["Admin", "Manager", "Sales"].includes(userRole)

    const handleDelete = async (contactId: string) => {
        if (!confirm("Bạn có chắc chắn muốn xóa liên hệ này?")) return

        setIsDeleting(contactId)
        try {
            const res = await fetch(`/api/contacts/${contactId}`, {
                method: "DELETE"
            })

            if (res.ok) {
                onUpdate()
            } else {
                const err = await res.json()
                alert(`Lỗi: ${err.error}`)
            }
        } catch (error) {
            console.error("Delete error", error)
            alert("Lỗi kết nối")
        } finally {
            setIsDeleting(null)
        }
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                    Người liên hệ ({contacts.length})
                </h4>
                {canEdit && (
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                            setEditingContact(null)
                            setShowForm(true)
                        }}
                        className="h-8 gap-1.5"
                    >
                        <Plus className="w-3.5 h-3.5" />
                        Thêm
                    </Button>
                )}
            </div>

            <div className="grid gap-3">
                {contacts.length === 0 ? (
                    <div className="text-sm text-muted-foreground italic bg-muted/30 p-4 rounded-lg text-center border border-dashed">
                        Chưa có thông tin liên hệ
                    </div>
                ) : (
                    contacts.map(contact => (
                        <div
                            key={contact.id}
                            className={`p-3 rounded-lg border bg-card transition-colors ${contact.is_primary ? "border-primary/50 bg-primary/5" : "hover:border-primary/30"
                                }`}
                        >
                            <div className="flex items-start justify-between gap-3">
                                <div className="flex-1 space-y-1">
                                    <div className="flex items-center gap-2">
                                        <span className="font-semibold">{contact.name}</span>
                                        {contact.is_primary && (
                                            <span className="text-[10px] bg-primary text-primary-foreground px-1.5 py-0.5 rounded-full font-medium flex items-center gap-1">
                                                <Star className="w-3 h-3 fill-current" /> Chính
                                            </span>
                                        )}
                                    </div>

                                    {contact.title && (
                                        <div className="flex items-center gap-2 text-sm text-foreground/80">
                                            <Briefcase className="w-3.5 h-3.5 text-muted-foreground" />
                                            <span>{contact.title}</span>
                                        </div>
                                    )}

                                    <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
                                        {contact.phone && (
                                            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                                                <Phone className="w-3.5 h-3.5" />
                                                <span>{contact.phone}</span>
                                            </div>
                                        )}
                                        {contact.email && (
                                            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                                                <Mail className="w-3.5 h-3.5" />
                                                <span>{contact.email}</span>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {canEdit && (
                                    <div className="flex items-center gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-7 w-7 text-muted-foreground hover:text-primary"
                                            onClick={() => {
                                                setEditingContact(contact)
                                                setShowForm(true)
                                            }}
                                        >
                                            <Edit className="w-3.5 h-3.5" />
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                            onClick={() => handleDelete(contact.id)}
                                            disabled={isDeleting === contact.id}
                                        >
                                            <Trash2 className="w-3.5 h-3.5" />
                                        </Button>
                                    </div>
                                )}
                            </div>
                        </div>
                    ))
                )}
            </div>

            {showForm && (
                <ContactFormDialog
                    open={showForm}
                    onOpenChange={setShowForm}
                    contact={editingContact}
                    customerId={customerId}
                    onSuccess={onUpdate}
                />
            )}
        </div>
    )
}

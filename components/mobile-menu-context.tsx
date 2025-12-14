"use client"

import { createContext, useContext, useState, ReactNode } from "react"

interface MobileMenuContextType {
  isOpen: boolean
  setIsOpen: (open: boolean) => void
  toggle: () => void
}

const MobileMenuContext = createContext<MobileMenuContextType | undefined>(undefined)

export function MobileMenuProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)

  const toggle = () => setIsOpen(prev => !prev)

  return (
    <MobileMenuContext.Provider value={{ isOpen, setIsOpen, toggle }}>
      {children}
    </MobileMenuContext.Provider>
  )
}

export function useMobileMenu() {
  const context = useContext(MobileMenuContext)
  if (context === undefined) {
    throw new Error("useMobileMenu must be used within a MobileMenuProvider")
  }
  return context
}

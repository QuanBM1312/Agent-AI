"use client"

import { useMobileMenu } from "./mobile-menu-context"

interface MobileMenuButtonProps {
  className?: string
}

export function MobileMenuButton({ className = "" }: MobileMenuButtonProps) {
  const { toggle } = useMobileMenu()

  return (
    <button
      onClick={toggle}
      className={`md:hidden p-2 hover:bg-muted rounded-lg transition-colors shrink-0 ${className}`}
      aria-label="Open menu"
    >
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
      </svg>
    </button>
  )
}

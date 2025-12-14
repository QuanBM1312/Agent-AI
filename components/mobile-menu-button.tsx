"use client"

interface MobileMenuButtonProps {
  className?: string
}

export function MobileMenuButton({ className = "" }: MobileMenuButtonProps) {
  const handleClick = () => {
    const event = new CustomEvent('toggleMobileMenu')
    window.dispatchEvent(event)
  }

  return (
    <button
      onClick={handleClick}
      className={`md:hidden p-2 hover:bg-muted rounded-lg transition-colors shrink-0 ${className}`}
      aria-label="Open menu"
    >
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
      </svg>
    </button>
  )
}

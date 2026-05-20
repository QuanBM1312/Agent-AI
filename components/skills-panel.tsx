"use client"

import { useEffect, useState } from "react"
import {
  BadgeCheck,
  BrainCircuit,
  Calculator,
  FileSearch,
  Globe,
  Loader2,
  Mic,
  Network,
  UploadCloud,
} from "lucide-react"
import { MobileMenuButton } from "@/components/mobile-menu-button"

type SkillStatus = "ready" | "partial" | "blocked"

interface SkillItem {
  id: string
  name: string
  status: SkillStatus
  statusLabel: string
  description: string
  evidence: string
}

const iconMap = {
  internal_knowledge_search: FileSearch,
  excel_calculation: Calculator,
  structured_ops_lookup: BrainCircuit,
  voice_transcription: Mic,
  web_search: Globe,
  n8n_agent0: Network,
  knowledge_ingestion: UploadCloud,
}

const statusClassName: Record<SkillStatus, string> = {
  ready: "border-emerald-200 bg-emerald-50 text-emerald-700",
  partial: "border-amber-200 bg-amber-50 text-amber-700",
  blocked: "border-red-200 bg-red-50 text-red-700",
}

export function SkillsPanel() {
  const [skills, setSkills] = useState<SkillItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadSkills() {
      setIsLoading(true)
      setError(null)

      try {
        const response = await fetch("/api/skills")
        if (!response.ok) {
          throw new Error(`Không tải được kỹ năng (${response.status})`)
        }

        const payload = await response.json()
        if (!cancelled) {
          setSkills(Array.isArray(payload.data) ? payload.data : [])
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Không tải được kỹ năng")
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    loadSkills()

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="border-b border-border p-3 md:p-6">
        <div className="flex items-start gap-3">
          <MobileMenuButton className="-ml-1 mt-0.5" />
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-bold text-foreground md:text-2xl">Kỹ năng</h2>
            <p className="mt-1 text-xs text-muted-foreground md:text-sm">
              Trạng thái các năng lực mà trợ lý có thể dùng khi trả lời.
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        {isLoading ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            Đang tải kỹ năng
          </div>
        ) : error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {skills.map((skill) => {
              const Icon = iconMap[skill.id as keyof typeof iconMap] || BadgeCheck

              return (
                <section key={skill.id} className="rounded-lg border border-border bg-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted">
                        <Icon className="h-5 w-5 text-foreground" />
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold text-foreground">{skill.name}</h3>
                        <span
                          className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusClassName[skill.status]}`}
                        >
                          {skill.statusLabel}
                        </span>
                      </div>
                    </div>
                  </div>

                  <p className="mt-3 text-sm leading-6 text-muted-foreground">{skill.description}</p>
                  <p className="mt-3 border-t border-border pt-3 text-xs leading-5 text-muted-foreground">
                    {skill.evidence}
                  </p>
                </section>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

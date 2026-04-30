"use client";

import { Loader2 } from "lucide-react";
import {
  ChatStageKey,
  getChatStageLabel,
} from "@/lib/chat-observability";

interface ChatRequestStatusProps {
  activeStage: ChatStageKey;
  stagePlan: ChatStageKey[];
  elapsedMs: number;
  requestId?: string;
}

export function ChatRequestStatus({
  activeStage,
  stagePlan,
  elapsedMs,
  requestId,
}: ChatRequestStatusProps) {
  return (
    <div className="bg-muted/50 border border-border rounded-lg px-4 py-3 space-y-3">
      <div className="flex items-center gap-2">
        <Loader2 className="w-3.5 h-3.5 animate-spin opacity-70" />
        <div className="min-w-0">
          <div className="text-xs font-medium text-foreground">
            {getChatStageLabel(activeStage)}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {Math.max(1, Math.round(elapsedMs / 1000))} giây • request{" "}
            <span className="font-mono">{requestId?.slice(0, 12) || "pending"}</span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {stagePlan.map((stage) => {
          const activeIndex = stagePlan.indexOf(activeStage);
          const stageIndex = stagePlan.indexOf(stage);
          const isDone = stageIndex < activeIndex;
          const isActive = stage === activeStage;

          return (
            <div
              key={stage}
              className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                isActive
                  ? "border-primary bg-primary/10 text-primary"
                  : isDone
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-border bg-background text-muted-foreground"
              }`}
            >
              {getChatStageLabel(stage)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

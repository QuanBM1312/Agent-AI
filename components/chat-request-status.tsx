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
  onCancel?: () => void;
}

export function ChatRequestStatus({
  activeStage,
  stagePlan,
  elapsedMs,
  requestId,
  onCancel,
}: ChatRequestStatusProps) {
  const isTakingLong = elapsedMs >= 12_000;

  return (
    <div className="bg-muted/50 border border-border rounded-lg px-4 py-3 space-y-3">
      <div className="flex items-start gap-3">
        <Loader2 className="w-3.5 h-3.5 animate-spin opacity-70 mt-0.5" />
        <div className="min-w-0">
          <div className="text-xs font-medium text-foreground">
            {getChatStageLabel(activeStage)}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {Math.max(1, Math.round(elapsedMs / 1000))} giây • request{" "}
            <span className="font-mono">{requestId?.slice(0, 12) || "pending"}</span>
          </div>
        </div>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="ml-auto rounded-md border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
          >
            Hủy
          </button>
        )}
      </div>

      {isTakingLong && (
        <p className="text-[11px] text-muted-foreground">
          Yêu cầu này đang xử lý lâu hơn bình thường. Bạn có thể tiếp tục chờ hoặc bấm Hủy để gửi câu hỏi khác.
        </p>
      )}

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

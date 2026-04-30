"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CHAT_TELEMETRY_UPDATED_EVENT,
  ChatRequestMetric,
  CHAT_STAGE_DEFINITIONS,
  readClientChatMetrics,
} from "@/lib/chat-observability";

interface ChatTelemetryPanelProps {
  sessionId: string;
}

function formatLatency(latencyMs: number) {
  if (latencyMs >= 1000) {
    return `${(latencyMs / 1000).toFixed(1)}s`;
  }

  return `${Math.round(latencyMs)}ms`;
}

export function ChatTelemetryPanel({ sessionId }: ChatTelemetryPanelProps) {
  const [localMetrics, setLocalMetrics] = useState<ChatRequestMetric[]>([]);
  const [persistedMetrics, setPersistedMetrics] = useState<ChatRequestMetric[]>([]);

  useEffect(() => {
    const loadMetrics = () => {
      setLocalMetrics(readClientChatMetrics());
    };

    loadMetrics();
    window.addEventListener("storage", loadMetrics);
    window.addEventListener(CHAT_TELEMETRY_UPDATED_EVENT, loadMetrics);

    return () => {
      window.removeEventListener("storage", loadMetrics);
      window.removeEventListener(CHAT_TELEMETRY_UPDATED_EVENT, loadMetrics);
    };
  }, []);

  useEffect(() => {
    let isCancelled = false;

    const loadPersistedMetrics = async () => {
      try {
        const response = await fetch(`/api/chat/metrics?session_id=${sessionId}`);
        if (!response.ok) {
          return;
        }

        const data = await response.json();
        if (!isCancelled && Array.isArray(data.data)) {
          setPersistedMetrics(data.data as ChatRequestMetric[]);
        }
      } catch (error) {
        console.error("Failed to load persisted chat metrics", error);
      }
    };

    loadPersistedMetrics();

    return () => {
      isCancelled = true;
    };
  }, [sessionId]);

  const metrics = useMemo(() => {
    const merged = [...localMetrics, ...persistedMetrics];
    const deduped = new Map<string, ChatRequestMetric>();

    for (const metric of merged) {
      const existing = deduped.get(metric.requestId);
      if (!existing || new Date(metric.timestamp).getTime() > new Date(existing.timestamp).getTime()) {
        deduped.set(metric.requestId, metric);
      }
    }

    return Array.from(deduped.values()).sort(
      (left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime()
    );
  }, [localMetrics, persistedMetrics]);

  const sessionMetrics = useMemo(
    () => metrics.filter((metric) => metric.sessionId === sessionId),
    [metrics, sessionId]
  );

  const recentMetrics = sessionMetrics.slice(0, 6);
  const successCount = sessionMetrics.filter((metric) => metric.outcome === "ok").length;
  const avgLatencyMs = sessionMetrics.length
    ? sessionMetrics.reduce((sum, metric) => sum + metric.latencyMs, 0) / sessionMetrics.length
    : 0;

  const routeSummary = Array.from(
    sessionMetrics.reduce((accumulator, metric) => {
      accumulator.set(metric.routeHint, (accumulator.get(metric.routeHint) || 0) + 1);
      return accumulator;
    }, new Map<string, number>())
  )
    .sort((left, right) => right[1] - left[1])
    .slice(0, 4);

  if (sessionMetrics.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border px-4 py-3 text-xs text-muted-foreground">
        Chưa có telemetry cho session này. Gửi ít nhất một request với `?telemetry=1` để bắt đầu quan sát latency và route.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card/70 p-4 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-sm font-semibold text-foreground">Chat telemetry</div>
        <div className="text-[11px] text-muted-foreground font-mono">{sessionId}</div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border border-border bg-background px-3 py-2">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Requests</div>
          <div className="mt-1 text-lg font-semibold">{sessionMetrics.length}</div>
        </div>
        <div className="rounded-lg border border-border bg-background px-3 py-2">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Success rate</div>
          <div className="mt-1 text-lg font-semibold">
            {Math.round((successCount / sessionMetrics.length) * 100)}%
          </div>
        </div>
        <div className="rounded-lg border border-border bg-background px-3 py-2">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Avg latency</div>
          <div className="mt-1 text-lg font-semibold">{formatLatency(avgLatencyMs)}</div>
        </div>
      </div>

      {routeSummary.length > 0 && (
        <div className="space-y-2">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Top routes</div>
          <div className="flex flex-wrap gap-2">
            {routeSummary.map(([routeHint, count]) => (
              <div
                key={routeHint}
                className="rounded-full border border-border bg-background px-2.5 py-1 text-[11px] text-foreground"
              >
                {routeHint} • {count}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Recent requests</div>
        <div className="space-y-2">
          {recentMetrics.map((metric) => (
            <div
              key={metric.requestId}
              className="rounded-lg border border-border bg-background px-3 py-2 text-xs"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[11px]">{metric.requestId.slice(0, 12)}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] ${
                    metric.outcome === "ok"
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-red-100 text-red-700"
                  }`}
                >
                  {metric.outcome}
                </span>
                <span className="text-muted-foreground">{metric.routeHint}</span>
                <span className="text-muted-foreground">{formatLatency(metric.latencyMs)}</span>
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                {CHAT_STAGE_DEFINITIONS[metric.stage]} • {new Date(metric.timestamp).toLocaleString("vi-VN")}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

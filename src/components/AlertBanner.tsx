"use client";

import Link from "next/link";
import useFetch from "@/lib/useFetch";

interface Alert { id: string; severity: "WARNING" | "CRITICAL"; title: string; detail: string | null; count: number; lastAt: string }

/** Failing integrations (webhooks, providers, feeds), shown on every console page. */
export default function AlertBanner({ isAdmin }: { isAdmin: boolean }) {
  const { data } = useFetch<{ open: Alert[] }>("/api/alerts", 60_000);
  const open = data?.open ?? [];
  if (!open.length) return null;
  const top = open[0];
  const critical = top.severity === "CRITICAL";
  return (
    <div
      role="alert"
      className={`mb-6 border px-4 py-3 text-sm flex items-start justify-between gap-4 ${
        critical ? "border-accent bg-accent-wash text-ink" : "border-line-strong bg-paper-sunken text-ink"
      }`}
    >
      <div className="min-w-0">
        <div className="font-medium">
          <span aria-hidden="true">{critical ? "● " : "▲ "}</span>
          {top.title}
          {top.count > 1 && <span className="figure text-xs text-ink-soft"> · {top.count}×</span>}
        </div>
        {top.detail && <div className="text-xs text-ink-soft mt-0.5 break-words">{top.detail}</div>}
        {open.length > 1 && <div className="text-xs text-ink-soft mt-1">+ {open.length - 1} more integration alert{open.length > 2 ? "s" : ""}</div>}
      </div>
      {isAdmin && (
        <Link href="/settings#integration-health" className="text-xs underline shrink-0">
          Integration health
        </Link>
      )}
    </div>
  );
}

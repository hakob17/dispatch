"use client";

import { useState } from "react";
import Link from "next/link";
import useFetch from "@/lib/useFetch";
import { Button, PageHeader } from "@/components/ui";

interface CampaignRow {
  id: string;
  name: string;
  channel: string;
  status: string;
  scheduledAt: string | null;
  launchedAt: string | null;
  recurrence: string;
}

const tone: Record<string, string> = {
  SCHEDULED: "bg-amber-wash text-amber",
  RUNNING: "bg-teal-wash text-teal",
  COMPLETED: "bg-good-wash text-good",
  CANCELED: "bg-paper-sunken text-ink-faint",
  FAILED: "bg-accent-wash text-accent-deep",
  DRAFT: "bg-paper-sunken text-ink-soft",
};

export default function CalendarPage() {
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const { data: campaigns } = useFetch<CampaignRow[]>("/api/campaigns");

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7; // Monday-first
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const byDay = new Map<number, CampaignRow[]>();
  for (const c of campaigns ?? []) {
    const when = c.scheduledAt ?? c.launchedAt;
    if (!when) continue;
    const d = new Date(when);
    if (d.getFullYear() === year && d.getMonth() === month) {
      const list = byDay.get(d.getDate()) ?? [];
      list.push(c);
      byDay.set(d.getDate(), list);
    }
  }

  const cells: (number | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const today = new Date();

  return (
    <div>
      <PageHeader
        kicker="Planning"
        title="Content calendar"
        actions={
          <div className="flex items-center gap-2">
            <Button small variant="ghost" onClick={() => setCursor(new Date(year, month - 1, 1))}>←</Button>
            <span className="figure text-sm w-36 text-center">
              {cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
            </span>
            <Button small variant="ghost" onClick={() => setCursor(new Date(year, month + 1, 1))}>→</Button>
          </div>
        }
      />

      <div className="rise grid grid-cols-7 border-l border-t border-line-strong bg-paper-raised">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="figure text-[10px] uppercase tracking-[0.2em] text-ink-faint px-2 py-2 border-r border-b border-line-strong bg-paper-sunken/50">
            {d}
          </div>
        ))}
        {cells.map((day, i) => {
          const isToday = day && today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;
          return (
            <div key={i} className={`min-h-24 border-r border-b border-line px-1.5 py-1 ${day ? "" : "bg-paper-sunken/30"}`}>
              {day && (
                <>
                  <div className={`figure text-[11px] mb-1 ${isToday ? "text-accent font-medium" : "text-ink-faint"}`}>
                    {day}{isToday ? " · today" : ""}
                  </div>
                  <div className="space-y-1">
                    {(byDay.get(day) ?? []).map((c) => (
                      <Link
                        key={c.id}
                        href={`/campaigns/${c.id}`}
                        className={`block text-[11px] px-1.5 py-1 truncate hover:opacity-70 ${tone[c.status] ?? "bg-paper-sunken"}`}
                        title={`${c.name} — ${c.channel} ${c.status}${c.recurrence !== "NONE" ? ` (${c.recurrence.toLowerCase()})` : ""}`}
                      >
                        {c.recurrence !== "NONE" && "↻ "}{c.name}
                      </Link>
                    ))}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-xs text-ink-faint mt-3">Campaigns appear on their scheduled (or launched) date. ↻ marks recurring campaigns.</p>
    </div>
  );
}

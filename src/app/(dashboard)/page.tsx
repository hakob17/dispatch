"use client";

import { useState } from "react";
import useFetch from "@/lib/useFetch";
import { Badge, Button, Card, EmptyState, PageHeader, Stat } from "@/components/ui";
import AreaChart, { SeriesDay } from "@/components/AreaChart";
import Link from "next/link";

interface Stats {
  contacts: number;
  segments: number;
  campaigns: number;
  activeJourneys: number;
  last30d: { sent: number; delivered: number; opened: number; clicked: number };
  suppressed: number;
  pendingJobs: number;
  recentCampaigns: {
    id: string;
    name: string;
    channel: string;
    status: string;
    createdAt: string;
    _count: { messages: number };
  }[];
}

const pct = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toFixed(1)}%` : "—");

const METRICS = [
  { key: "sent", label: "Sent", color: "var(--accent)" },
  { key: "delivered", label: "Delivered", color: "var(--teal)" },
  { key: "opened", label: "Opened", color: "var(--ink)" },
  { key: "clicked", label: "Clicked", color: "var(--amber)" },
  { key: "events", label: "Events", color: "var(--ink-faint)" },
] as const;

export default function Overview() {
  const { data } = useFetch<Stats>("/api/stats", 5000);
  const [range, setRange] = useState(30);
  const [metric, setMetric] = useState<string>("sent");
  const { data: series } = useFetch<{ days: SeriesDay[] }>(`/api/stats/timeseries?days=${range}`);

  const total = (key: string) => series?.days.reduce((s, d) => s + (Number(d[key]) || 0), 0) ?? 0;
  const activeMetric = METRICS.find((m) => m.key === metric) ?? METRICS[0];

  // % change: second half of the range vs first half
  const trend = (() => {
    if (!series?.days.length) return null;
    const half = Math.floor(series.days.length / 2);
    const a = series.days.slice(0, half).reduce((s, d) => s + (Number(d[metric]) || 0), 0);
    const b = series.days.slice(half).reduce((s, d) => s + (Number(d[metric]) || 0), 0);
    if (a === 0) return b > 0 ? "+∞" : null;
    return `${b >= a ? "+" : ""}${(((b - a) / a) * 100).toFixed(0)}%`;
  })();

  return (
    <div>
      <PageHeader
        kicker="Overview"
        title="The morning report"
        actions={<Button href="/campaigns/new">New campaign</Button>}
      />

      {data && (
        <>
          <div className="grid grid-cols-4 gap-4 mb-4">
            <div className="rise rise-1"><Stat label="Contacts" value={data.contacts.toLocaleString()} /></div>
            <div className="rise rise-2"><Stat label="Sent · 30d" value={data.last30d.sent.toLocaleString()} accent /></div>
            <div className="rise rise-3"><Stat label="Open rate" value={pct(data.last30d.opened, data.last30d.sent)} sub={`${data.last30d.opened.toLocaleString()} opened`} /></div>
            <div className="rise rise-4"><Stat label="Click rate" value={pct(data.last30d.clicked, data.last30d.sent)} sub={`${data.last30d.clicked.toLocaleString()} clicked`} /></div>
          </div>

          <Card className="rise rise-2 mb-4">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <div className="flex gap-1">
                {METRICS.map((m) => (
                  <button
                    key={m.key}
                    onClick={() => setMetric(m.key)}
                    className={`figure text-[11px] uppercase tracking-wider px-2.5 py-1 transition-colors ${
                      metric === m.key ? "bg-ink text-paper" : "text-ink-soft hover:text-ink"
                    }`}
                  >
                    {m.label} <span className="opacity-60">{total(m.key).toLocaleString()}</span>
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                {trend && (
                  <span className={`figure text-xs ${trend.startsWith("-") ? "text-accent" : "text-good"}`}>{trend} vs prior half</span>
                )}
                {[7, 30, 90].map((d) => (
                  <button
                    key={d}
                    onClick={() => setRange(d)}
                    className={`figure text-[11px] px-2 py-1 border ${
                      range === d ? "border-ink text-ink" : "border-line text-ink-faint hover:text-ink"
                    }`}
                  >
                    {d}d
                  </button>
                ))}
              </div>
            </div>
            {series && <AreaChart data={series.days} metric={metric} color={activeMetric.color} height={140} />}
          </Card>

          <div className="grid grid-cols-4 gap-4 mb-10">
            <div className="rise rise-2"><Stat label="Delivered · 30d" value={data.last30d.delivered.toLocaleString()} /></div>
            <div className="rise rise-3"><Stat label="Active journeys" value={data.activeJourneys} /></div>
            <div className="rise rise-3"><Stat label="Suppressed" value={data.suppressed.toLocaleString()} sub="unsubscribes + bounces + complaints" /></div>
            <div className="rise rise-4"><Stat label="Queue depth" value={data.pendingJobs} sub={data.pendingJobs > 0 ? "worker busy" : "all clear"} /></div>
          </div>

          <div className="rise rise-4">
            <h2 className="text-xl mb-4">Recent campaigns</h2>
            {data.recentCampaigns.length === 0 ? (
              <EmptyState
                title="Nothing sent yet"
                hint="Create your first campaign — pick a template, choose an audience, press send."
                action={<Button href="/campaigns/new">Create campaign</Button>}
              />
            ) : (
              <div className="grid grid-cols-2 gap-4">
                {data.recentCampaigns.map((c) => (
                  <Link key={c.id} href={`/campaigns/${c.id}`} className="card p-4 block hover:-translate-y-0.5 transition-transform">
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-medium truncate">{c.name}</div>
                      <Badge>{c.status}</Badge>
                    </div>
                    <div className="figure text-xs text-ink-faint mt-2">
                      {c.channel} · {c._count.messages.toLocaleString()} messages ·{" "}
                      {new Date(c.createdAt).toLocaleDateString()}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

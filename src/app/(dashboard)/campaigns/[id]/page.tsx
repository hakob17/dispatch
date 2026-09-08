"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import useFetch from "@/lib/useFetch";
import { Badge, Button, Card, PageHeader, Stat, Table } from "@/components/ui";
import TemplatePreview, { PreviewableTemplate } from "@/components/TemplatePreview";

interface Detail {
  campaign: {
    id: string;
    name: string;
    channel: string;
    status: string;
    trigger: "SCHEDULED" | "EVENT";
    triggerEvent: string | null;
    recurrence: "NONE" | "DAILY" | "WEEKLY";
    conversionEvent: string | null;
    controlGroupPct: number;
    scheduledAt: string | null;
    launchedAt: string | null;
    segment: { name: string } | null;
    variants: { id: string; name: string; weight: number; template: PreviewableTemplate & { name: string } }[];
  };
  stats: {
    byStatus: Record<string, number>;
    opened: number;
    clicked: number;
    converted: number;
    heldOutConverted: number;
    variantOpens: Record<string, number>;
    variantClicks: Record<string, number>;
  };
  failures: { id: string; status: string; error: string | null; contact: { email: string | null; firstName: string | null } }[];
}

const pct = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toFixed(1)}%` : "—");

export default function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data, refresh } = useFetch<Detail>(`/api/campaigns/${id}`, 5000);

  if (!data) return null;
  const { campaign, stats, failures } = data;
  const s = stats.byStatus;
  const total = Object.values(s).reduce((a, b) => a + b, 0);
  const sent = (s.SENT ?? 0) + (s.DELIVERED ?? 0) + (s.BOUNCED ?? 0);
  const heldOut = s.HELD_OUT ?? 0;

  // Lift: conversion rate of the sent group vs the held-out control group
  const sentConvRate = sent > 0 ? stats.converted / sent : 0;
  const controlConvRate = heldOut > 0 ? stats.heldOutConverted / heldOut : 0;
  const lift =
    heldOut > 0 && controlConvRate > 0
      ? `${(((sentConvRate - controlConvRate) / controlConvRate) * 100).toFixed(0)}%`
      : heldOut > 0 && sentConvRate > 0
        ? "∞"
        : null;

  const stop = async () => {
    if (!confirm("Stop this campaign? It will stop firing/recurring and be marked completed.")) return;
    await fetch(`/api/campaigns/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "stop" }),
    });
    refresh();
  };

  const cancel = async () => {
    if (!confirm("Cancel this campaign? Queued messages will not be sent.")) return;
    await fetch(`/api/campaigns/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "cancel" }),
    });
    refresh();
  };

  const remove = async () => {
    if (!confirm("Delete this campaign and its message log?")) return;
    await fetch(`/api/campaigns/${id}`, { method: "DELETE" });
    router.push("/campaigns");
  };

  return (
    <div>
      <PageHeader
        kicker={`Campaign · ${campaign.channel}`}
        title={campaign.name}
        actions={
          <>
            {campaign.trigger === "EVENT" && <Badge tone="RUNNING">⚡ on &quot;{campaign.triggerEvent}&quot;</Badge>}
            {campaign.recurrence !== "NONE" && <Badge tone="SCHEDULED">↻ {campaign.recurrence.toLowerCase()}</Badge>}
            <Badge>{campaign.status}</Badge>
            {campaign.status === "RUNNING" && (campaign.trigger === "EVENT" || campaign.recurrence !== "NONE") && (
              <Button small onClick={stop}>Stop</Button>
            )}
            {(campaign.status === "RUNNING" || campaign.status === "SCHEDULED") && (
              <Button variant="danger" small onClick={cancel}>Cancel</Button>
            )}
            {campaign.status !== "RUNNING" && <Button variant="ghost" small onClick={remove}>Delete</Button>}
          </>
        }
      />

      <div className="grid grid-cols-5 gap-4 mb-4">
        <div className="rise rise-1"><Stat label="Audience" value={total.toLocaleString()} sub={campaign.segment?.name ?? "everyone"} /></div>
        <div className="rise rise-1"><Stat label="Sent" value={sent.toLocaleString()} accent /></div>
        <div className="rise rise-2"><Stat label="Delivered" value={(s.DELIVERED ?? 0).toLocaleString()} sub={pct(s.DELIVERED ?? 0, sent)} /></div>
        <div className="rise rise-3"><Stat label="Opened" value={stats.opened.toLocaleString()} sub={pct(stats.opened, sent)} /></div>
        <div className="rise rise-4"><Stat label="Clicked" value={stats.clicked.toLocaleString()} sub={pct(stats.clicked, sent)} /></div>
      </div>

      {campaign.conversionEvent && (
        <div className="grid grid-cols-4 gap-4 mb-8">
          <div className="rise rise-2"><Stat label={`Conversions · "${campaign.conversionEvent}"`} value={stats.converted.toLocaleString()} sub={pct(stats.converted, sent)} accent /></div>
          {campaign.controlGroupPct > 0 && (
            <>
              <div className="rise rise-3"><Stat label="Control group" value={heldOut.toLocaleString()} sub={`${campaign.controlGroupPct}% held out`} /></div>
              <div className="rise rise-3"><Stat label="Control conversions" value={stats.heldOutConverted.toLocaleString()} sub={pct(stats.heldOutConverted, heldOut)} /></div>
              <div className="rise rise-4"><Stat label="Lift vs control" value={lift ?? "—"} sub={lift ? "sent group vs held-out" : "needs conversions in both groups"} /></div>
            </>
          )}
        </div>
      )}
      {!campaign.conversionEvent && <div className="mb-4" />}

      <div className="grid grid-cols-2 gap-6 mb-8">
        <Card className="rise rise-2">
          <div className="figure text-[11px] uppercase tracking-[0.18em] text-ink-soft mb-3">Pipeline</div>
          {["QUEUED", "SENDING", "SENT", "DELIVERED", "BOUNCED", "FAILED", "SUPPRESSED"].map((st) => {
            const n = s[st] ?? 0;
            return (
              <div key={st} className="flex items-center gap-3 py-1">
                <span className="figure text-[10px] uppercase tracking-wider w-24 text-ink-soft">{st}</span>
                <div className="flex-1 bg-paper-sunken h-4 relative">
                  <div
                    className={`h-4 ${st === "FAILED" || st === "BOUNCED" ? "bg-accent" : st === "DELIVERED" ? "bg-teal" : "bg-ink"}`}
                    style={{ width: total ? `${(n / total) * 100}%` : 0 }}
                  />
                </div>
                <span className="figure text-sm w-16 text-right">{n.toLocaleString()}</span>
              </div>
            );
          })}
        </Card>

        <Card className="rise rise-3">
          <div className="figure text-[11px] uppercase tracking-[0.18em] text-ink-soft mb-3">
            {campaign.variants.length > 1 ? "A/B variants" : "Content"}
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] figure uppercase tracking-wider text-ink-faint">
                <th className="py-1.5 pr-4 font-normal">Variant</th>
                <th className="pr-4 font-normal">Template</th>
                <th className="pr-4 font-normal">Split</th>
                <th className="pr-4 font-normal">Opens</th>
                <th className="font-normal">Clicks</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {campaign.variants.map((v) => (
                <tr key={v.id}>
                  <td className="py-2 figure text-accent">{v.name}</td>
                  <td>{v.template.name}</td>
                  <td className="figure">{v.weight}%</td>
                  <td className="figure">{stats.variantOpens[v.id] ?? 0}</td>
                  <td className="figure">{stats.variantClicks[v.id] ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <div className="rise rise-4 mb-8">
        <h2 className="text-lg mb-3">Content</h2>
        <div className={`grid gap-4 ${campaign.variants.length > 1 ? "grid-cols-2" : "grid-cols-1 max-w-2xl"}`}>
          {campaign.variants.map((v) => (
            <div key={v.id}>
              <div className="flex items-center gap-2 mb-2">
                <span className="figure text-xs text-accent">{v.name}</span>
                <span className="text-xs text-ink-soft">{v.template.name}</span>
                <span className="figure text-[10px] text-ink-faint">· {v.weight}%</span>
              </div>
              <TemplatePreview template={v.template} height={campaign.variants.length > 1 ? 320 : 420} />
            </div>
          ))}
        </div>
      </div>

      {failures.length > 0 && (
        <div className="rise rise-4">
          <h2 className="text-lg mb-3 text-accent-deep">Failures</h2>
          <Table head={["Contact", "Status", "Error"]}>
            {failures.map((f) => (
              <tr key={f.id}>
                <td className="px-4 py-2.5">{f.contact.email ?? f.contact.firstName ?? "—"}</td>
                <td className="px-4 py-2.5"><Badge>{f.status}</Badge></td>
                <td className="px-4 py-2.5 figure text-xs text-ink-soft max-w-md truncate">{f.error ?? "—"}</td>
              </tr>
            ))}
          </Table>
        </div>
      )}
    </div>
  );
}

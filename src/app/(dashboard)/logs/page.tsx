"use client";

import { useState } from "react";
import Link from "next/link";
import useFetch from "@/lib/useFetch";
import { Badge, Button, PageHeader, Table, inputCls } from "@/components/ui";

const STATUSES = ["", "QUEUED", "SENDING", "SENT", "DELIVERED", "BOUNCED", "FAILED", "SUPPRESSED", "HELD_OUT"];
const CHANNELS = ["", "EMAIL", "WEB_PUSH", "FCM", "WEBHOOK"];

interface MessageRow {
  id: string;
  channel: string;
  status: string;
  error: string | null;
  createdAt: string;
  sentAt: string | null;
  contact: { id: string; email: string | null };
  campaign: { id: string; name: string } | null;
  journeyStep: { journey: { id: string; name: string } } | null;
}

interface EventRow {
  id: string;
  name: string;
  properties: Record<string, unknown>;
  createdAt: string;
  contact: { id: string; email: string | null };
}

export default function LogsPage() {
  const [tab, setTab] = useState<"messages" | "events">("messages");
  return (
    <div>
      <PageHeader
        kicker="Activity"
        title="Logs"
        actions={
          <div className="flex gap-0 border border-line-strong">
            {(["messages", "events"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-1.5 text-sm capitalize ${tab === t ? "bg-ink text-paper" : "text-ink-soft hover:text-ink"}`}
              >
                {t}
              </button>
            ))}
          </div>
        }
      />
      {tab === "messages" ? <MessageLog /> : <EventLog />}
    </div>
  );
}

function MessageLog() {
  const [status, setStatus] = useState("");
  const [channel, setChannel] = useState("");
  const [page, setPage] = useState(1);
  const { data } = useFetch<{ rows: MessageRow[]; total: number; pageSize: number }>(
    `/api/logs?type=messages&status=${status}&channel=${channel}&page=${page}`,
    10000
  );

  return (
    <div className="rise">
      <div className="flex gap-3 mb-4 items-center">
        <select className={inputCls + " w-44"} aria-label="Filter by status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          {STATUSES.map((s) => <option key={s} value={s}>{s || "All statuses"}</option>)}
        </select>
        <select className={inputCls + " w-44"} aria-label="Filter by channel" value={channel} onChange={(e) => { setChannel(e.target.value); setPage(1); }}>
          {CHANNELS.map((c) => <option key={c} value={c}>{c || "All channels"}</option>)}
        </select>
        {data && <span className="figure text-xs text-ink-faint">{data.total.toLocaleString()} messages</span>}
      </div>
      <Table head={["Contact", "Source", "Channel", "Status", "Error", "When"]}>
        {data?.rows.map((m) => (
          <tr key={m.id}>
            <td className="px-4 py-2.5">
              <Link href={`/contacts/${m.contact.id}`} className="hover:text-accent">{m.contact.email ?? "—"}</Link>
            </td>
            <td className="px-4 py-2.5 text-xs">
              {m.campaign ? (
                <Link href={`/campaigns/${m.campaign.id}`} className="hover:text-accent">{m.campaign.name}</Link>
              ) : m.journeyStep ? (
                <Link href={`/journeys/${m.journeyStep.journey.id}`} className="hover:text-accent">⤳ {m.journeyStep.journey.name}</Link>
              ) : (
                <span className="text-ink-faint italic">test</span>
              )}
            </td>
            <td className="px-4 py-2.5 figure text-xs">{m.channel}</td>
            <td className="px-4 py-2.5"><Badge>{m.status}</Badge></td>
            <td className="px-4 py-2.5 figure text-[11px] text-ink-faint max-w-48 truncate">{m.error ?? ""}</td>
            <td className="px-4 py-2.5 figure text-xs text-ink-faint">{new Date(m.createdAt).toLocaleString()}</td>
          </tr>
        ))}
      </Table>
      <Pager page={page} setPage={setPage} total={data?.total ?? 0} pageSize={data?.pageSize ?? 50} />
    </div>
  );
}

function EventLog() {
  const [name, setName] = useState("");
  const [page, setPage] = useState(1);
  const { data } = useFetch<{ rows: EventRow[]; total: number; pageSize: number; names: { name: string; _count: number }[] }>(
    `/api/logs?type=events&name=${encodeURIComponent(name)}&page=${page}`,
    10000
  );

  return (
    <div className="rise">
      <div className="flex gap-2 mb-4 items-center flex-wrap">
        <input className={inputCls + " w-56"} aria-label="Filter by event name" placeholder="Filter by event name…" value={name} onChange={(e) => { setName(e.target.value); setPage(1); }} />
        {data?.names.map((n) => (
          <button
            key={n.name}
            onClick={() => { setName(n.name); setPage(1); }}
            className={`figure text-[11px] px-2 py-1 border ${name === n.name ? "border-ink" : "border-line text-ink-faint hover:text-ink"}`}
          >
            {n.name} · {n._count}
          </button>
        ))}
      </div>
      <Table head={["Event", "Contact", "Properties", "When"]}>
        {data?.rows.map((e) => (
          <tr key={e.id}>
            <td className="px-4 py-2.5 font-medium">{e.name}</td>
            <td className="px-4 py-2.5">
              <Link href={`/contacts/${e.contact.id}`} className="hover:text-accent">{e.contact.email ?? "—"}</Link>
            </td>
            <td className="px-4 py-2.5 figure text-[11px] text-ink-faint max-w-60 truncate">{JSON.stringify(e.properties)}</td>
            <td className="px-4 py-2.5 figure text-xs text-ink-faint">{new Date(e.createdAt).toLocaleString()}</td>
          </tr>
        ))}
      </Table>
      <Pager page={page} setPage={setPage} total={data?.total ?? 0} pageSize={data?.pageSize ?? 50} />
    </div>
  );
}

function Pager({ page, setPage, total, pageSize }: { page: number; setPage: (p: number) => void; total: number; pageSize: number }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <div className="flex items-center gap-3 mt-4">
      <Button small variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Prev</Button>
      <span className="figure text-xs text-ink-faint">page {page} / {pages}</span>
      <Button small variant="ghost" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next →</Button>
    </div>
  );
}

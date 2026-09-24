"use client";

import { use, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useFetch from "@/lib/useFetch";
import { Badge, Button, PageHeader, Stat } from "@/components/ui";
import JourneyFlow, { type Catalogs, type VisitStats } from "@/components/journey/JourneyFlow";
import { toTree, type StoredStep } from "@/components/journey/model";

interface Detail {
  journey: {
    id: string;
    name: string;
    status: string;
    entryKey: string | null;
    triggerEvent: string | null;
    exitEvent: string | null;
    segment: { name: string } | null;
    steps: StoredStep[];
  };
  stats: {
    total: number;
    completed: number;
    waiting: number;
    stepStats: { journeyStepId: string | null; status: string; _count: number }[];
    visits: { nodeKey: string; branch: string | null; count: number }[];
    exits: { reason: string; count: number }[];
  };
}

const EXIT_LABELS: Record<string, string> = {
  completed: "reached the end",
  exit_node: "exit step",
  exit_event: "exit event",
  loop_guard: "stopped (loop)",
};

export default function JourneyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data, refresh } = useFetch<Detail>(`/api/journeys/${id}`, 5000);
  const { data: templates } = useFetch<Catalogs["templates"]>("/api/templates");
  const { data: segments } = useFetch<Catalogs["segments"]>("/api/segments");
  const { data: groups } = useFetch<Catalogs["groups"]>("/api/subscription-groups");

  const tree = useMemo(() => (data ? toTree(data.journey.steps, data.journey.entryKey) : null), [data]);
  const stats: VisitStats = useMemo(() => {
    const m: VisitStats = new Map();
    if (!data) return m;
    if (data.journey.entryKey) {
      for (const v of data.stats.visits) {
        const e = m.get(v.nodeKey) ?? { total: 0, branches: {} };
        // A WAIT_EVENT logs its entry (no branch) and later its exit (event/timeout): count entries only
        if (v.branch !== "event" && v.branch !== "timeout") e.total += v.count;
        if (v.branch) e.branches[v.branch] = (e.branches[v.branch] ?? 0) + v.count;
        m.set(v.nodeKey, e);
      }
    } else {
      // Linear journeys: messages sent per step
      for (const s of data.journey.steps) {
        const sent = data.stats.stepStats.filter((x) => x.journeyStepId === s.id && ["SENT", "DELIVERED"].includes(x.status)).reduce((a, b) => a + b._count, 0);
        m.set(s.id, { total: sent, branches: {} });
      }
    }
    return m;
  }, [data]);

  if (!data) return null;
  const { journey } = data;

  const act = async (action: string) => {
    await fetch(`/api/journeys/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
    refresh();
  };
  const remove = async () => {
    if (!confirm("Delete this journey?")) return;
    await fetch(`/api/journeys/${id}`, { method: "DELETE" });
    router.push("/journeys");
  };

  const entry = journey.triggerEvent ? `on "${journey.triggerEvent}"${journey.segment ? ` · ${journey.segment.name}` : ""}` : journey.segment?.name ?? "everyone";

  return (
    <div>
      <PageHeader
        kicker="Journey"
        title={journey.name}
        actions={
          <>
            <Badge>{journey.status}</Badge>
            {journey.status === "DRAFT" && <Link href={`/journeys/${id}/edit`} className="text-sm underline">Edit</Link>}
            {journey.status !== "ACTIVE" && <Button small onClick={() => act("activate")}>Activate</Button>}
            {journey.status === "ACTIVE" && <Button small variant="ghost" onClick={() => act("pause")}>Pause</Button>}
            <Button small variant="danger" onClick={remove}>Delete</Button>
          </>
        }
      />

      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="rise rise-1"><Stat label="Entered" value={data.stats.total.toLocaleString()} sub={entry} /></div>
        <div className="rise rise-2"><Stat label="In flight" value={(data.stats.total - data.stats.completed).toLocaleString()} accent /></div>
        <div className="rise rise-3"><Stat label="Waiting for an event" value={data.stats.waiting.toLocaleString()} /></div>
        <div className="rise rise-4">
          <Stat
            label="Finished"
            value={data.stats.completed.toLocaleString()}
            sub={data.stats.exits.map((e) => `${e.count} ${EXIT_LABELS[e.reason] ?? e.reason}`).join(" · ") || undefined}
          />
        </div>
      </div>
      {journey.exitEvent && <p className="text-sm text-ink-soft mb-4">Readers leave as soon as they do <span className="figure">{journey.exitEvent}</span>.</p>}

      <div className="card p-5 rise rise-3">
        <h2 className="text-lg mb-4">Flow</h2>
        <JourneyFlow root={tree} catalogs={{ templates: templates ?? [], segments: segments ?? [], groups: groups ?? [] }} stats={stats} />
        {journey.status === "ACTIVE" && !journey.triggerEvent && (
          <p className="text-xs text-ink-faint mt-2">Segment journeys enrol matching readers on activation; new readers are enrolled when you re-activate.</p>
        )}
      </div>
    </div>
  );
}

"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import useFetch from "@/lib/useFetch";
import { Badge, Button, Card, PageHeader, Stat } from "@/components/ui";

interface Detail {
  journey: {
    id: string;
    name: string;
    status: string;
    segment: { name: string } | null;
    steps: { id: string; order: number; delayMinutes: number; channel: string; template: { name: string } }[];
  };
  stats: {
    total: number;
    completed: number;
    stepStats: { journeyStepId: string | null; status: string; _count: number }[];
  };
}

export default function JourneyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data, refresh } = useFetch<Detail>(`/api/journeys/${id}`, 5000);

  if (!data) return null;
  const { journey, stats } = data;

  const act = async (action: string) => {
    await fetch(`/api/journeys/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    refresh();
  };

  const remove = async () => {
    if (!confirm("Delete this journey?")) return;
    await fetch(`/api/journeys/${id}`, { method: "DELETE" });
    router.push("/journeys");
  };

  const sentForStep = (stepId: string) =>
    stats.stepStats
      .filter((s) => s.journeyStepId === stepId && ["SENT", "DELIVERED"].includes(s.status))
      .reduce((a, b) => a + b._count, 0);

  return (
    <div>
      <PageHeader
        kicker="Journey"
        title={journey.name}
        actions={
          <>
            <Badge>{journey.status}</Badge>
            {journey.status !== "ACTIVE" && <Button small onClick={() => act("activate")}>Activate</Button>}
            {journey.status === "ACTIVE" && <Button small variant="ghost" onClick={() => act("pause")}>Pause</Button>}
            <Button small variant="danger" onClick={remove}>Delete</Button>
          </>
        }
      />

      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="rise rise-1"><Stat label="Enrolled" value={stats.total.toLocaleString()} sub={journey.segment?.name ?? "everyone"} /></div>
        <div className="rise rise-2"><Stat label="Completed" value={stats.completed.toLocaleString()} /></div>
        <div className="rise rise-3"><Stat label="In flight" value={(stats.total - stats.completed).toLocaleString()} accent /></div>
      </div>

      <div className="rise rise-3 max-w-2xl">
        <h2 className="text-lg mb-4">Flow</h2>
        <div className="relative pl-8">
          <div className="absolute left-2.5 top-2 bottom-2 w-px bg-line-strong" />
          {journey.steps.map((s, i) => (
            <div key={s.id} className="relative pb-4">
              <div className="absolute -left-8 top-3 w-5 h-5 bg-ink text-paper figure text-[10px] flex items-center justify-center">
                {i + 1}
              </div>
              <Card className="flex items-center justify-between gap-4">
                <div>
                  {s.delayMinutes > 0 && (
                    <div className="figure text-[10px] uppercase tracking-wider text-amber mb-1">⏱ wait {s.delayMinutes} min</div>
                  )}
                  <div className="font-medium text-sm">{s.template.name}</div>
                  <div className="figure text-[10px] text-ink-faint mt-0.5">{s.channel}</div>
                </div>
                <div className="figure text-2xl text-ink-soft">{sentForStep(s.id).toLocaleString()}<span className="text-xs text-ink-faint"> sent</span></div>
              </Card>
            </div>
          ))}
        </div>
        {journey.status === "ACTIVE" && (
          <p className="text-xs text-ink-faint mt-2">
            Active journeys enroll matching contacts when activated. New contacts are enrolled on re-activation.
          </p>
        )}
      </div>
    </div>
  );
}

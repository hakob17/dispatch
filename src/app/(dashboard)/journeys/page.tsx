"use client";

import Link from "next/link";
import useFetch from "@/lib/useFetch";
import { Badge, Button, EmptyState, PageHeader, Table } from "@/components/ui";

interface JourneyRow {
  id: string;
  name: string;
  status: string;
  segment: { name: string } | null;
  entryKey: string | null;
  triggerEvent: string | null;
  steps: { type: string; channel: string | null; delayMinutes: number; template: { name: string } | null }[];
  _count: { runs: number };
}

/** Branching journeys: "3 messages · 2 splits · waits for events". */
function summarize(steps: JourneyRow["steps"]): string {
  const n = (t: string) => steps.filter((s) => s.type === t).length;
  const parts = [
    `${n("MESSAGE")} message${n("MESSAGE") === 1 ? "" : "s"}`,
    n("CONDITION") + n("RANDOM") ? `${n("CONDITION") + n("RANDOM")} split${n("CONDITION") + n("RANDOM") === 1 ? "" : "s"}` : "",
    n("WAIT_EVENT") ? "waits for events" : "",
  ];
  return parts.filter(Boolean).join(" · ");
}

export default function JourneysPage() {
  const { data } = useFetch<JourneyRow[]>("/api/journeys", 10000);

  return (
    <div>
      <PageHeader
        kicker="Orchestration"
        title="Journeys"
        actions={<Button href="/journeys/new">New journey</Button>}
      />
      {data && data.length === 0 ? (
        <EmptyState
          title="No journeys"
          hint="A journey walks each reader through messages, delays, condition and A/B splits and waits for their actions — like a Braze Canvas."
          action={<Button href="/journeys/new">Create journey</Button>}
        />
      ) : (
        <div className="rise rise-1">
          <Table head={["Journey", "Entry audience", "Steps", "Enrolled", "Status"]}>
            {data?.map((j) => (
              <tr key={j.id} className="hover:bg-paper-sunken/40">
                <td className="px-4 py-3">
                  <Link href={`/journeys/${j.id}`} className="font-medium hover:text-accent">{j.name}</Link>
                </td>
                <td className="px-4 py-3 text-sm text-ink-soft">
                  {j.triggerEvent ? <span className="figure">on {j.triggerEvent}</span> : j.segment?.name ?? "Everyone"}
                </td>
                <td className="px-4 py-3 figure text-xs text-ink-soft">
                  {j.entryKey
                    ? summarize(j.steps)
                    : j.steps.map((s, i) => `${i > 0 || s.delayMinutes > 0 ? `⏱${s.delayMinutes}m → ` : ""}${s.channel}`).join(" → ")}
                </td>
                <td className="px-4 py-3 figure">{j._count.runs.toLocaleString()}</td>
                <td className="px-4 py-3"><Badge>{j.status}</Badge></td>
              </tr>
            ))}
          </Table>
        </div>
      )}
    </div>
  );
}

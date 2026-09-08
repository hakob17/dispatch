"use client";

import Link from "next/link";
import useFetch from "@/lib/useFetch";
import { Badge, Button, EmptyState, PageHeader, Table } from "@/components/ui";

interface JourneyRow {
  id: string;
  name: string;
  status: string;
  segment: { name: string } | null;
  steps: { channel: string; delayMinutes: number; template: { name: string } }[];
  _count: { runs: number };
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
          hint="A journey enrolls a segment and walks each contact through a timed sequence of messages — like a tiny Braze Canvas."
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
                <td className="px-4 py-3 text-sm text-ink-soft">{j.segment?.name ?? "Everyone"}</td>
                <td className="px-4 py-3 figure text-xs text-ink-soft">
                  {j.steps.map((s, i) => `${i > 0 || s.delayMinutes > 0 ? `⏱${s.delayMinutes}m → ` : ""}${s.channel}`).join(" → ")}
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

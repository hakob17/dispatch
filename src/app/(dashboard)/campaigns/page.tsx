"use client";

import Link from "next/link";
import useFetch from "@/lib/useFetch";
import { Badge, Button, EmptyState, PageHeader, Table } from "@/components/ui";

interface CampaignRow {
  id: string;
  name: string;
  channel: string;
  status: string;
  trigger: string;
  triggerEvent: string | null;
  recurrence: string;
  tags: string[];
  scheduledAt: string | null;
  createdAt: string;
  segment: { name: string } | null;
  variants: { name: string; weight: number; template: { name: string } }[];
  _count: { messages: number };
}

export default function CampaignsPage() {
  const { data } = useFetch<CampaignRow[]>("/api/campaigns", 5000);

  return (
    <div>
      <PageHeader kicker="Messaging" title="Campaigns" actions={<Button href="/campaigns/new">New campaign</Button>} />
      {data && data.length === 0 ? (
        <EmptyState
          title="No campaigns yet"
          hint="A campaign sends one template (or an A/B split) to a segment over a single channel."
          action={<Button href="/campaigns/new">Create campaign</Button>}
        />
      ) : (
        <div className="rise rise-1">
          <Table head={["Campaign", "Channel", "Audience", "Content", "Messages", "Status"]}>
            {data?.map((c) => (
              <tr key={c.id} className="hover:bg-paper-sunken/40">
                <td className="px-4 py-3">
                  <Link href={`/campaigns/${c.id}`} className="font-medium hover:text-accent">{c.name}</Link>
                  {c.trigger === "EVENT" && <span className="figure text-[10px] text-teal ml-2">⚡{c.triggerEvent}</span>}
                  {c.recurrence !== "NONE" && <span className="figure text-[10px] text-amber ml-2">↻ {c.recurrence.toLowerCase()}</span>}
                  <div className="figure text-[10px] text-ink-faint mt-0.5">
                    {new Date(c.createdAt).toLocaleString()}
                    {(c.tags ?? []).map((t) => (
                      <span key={t} className="ml-1.5 bg-paper-sunken px-1.5 py-0.5 text-ink-soft">#{t}</span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3"><Badge tone="QUEUED">{c.channel}</Badge></td>
                <td className="px-4 py-3 text-sm text-ink-soft">{c.segment?.name ?? "Everyone"}</td>
                <td className="px-4 py-3 text-xs text-ink-soft">
                  {c.variants.map((v) => `${v.name} ${v.weight}% · ${v.template.name}`).join(" / ")}
                </td>
                <td className="px-4 py-3 figure">{c._count.messages.toLocaleString()}</td>
                <td className="px-4 py-3"><Badge>{c.status}</Badge></td>
              </tr>
            ))}
          </Table>
        </div>
      )}
    </div>
  );
}

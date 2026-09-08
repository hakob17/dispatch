"use client";

import Link from "next/link";
import useFetch from "@/lib/useFetch";
import { Button, EmptyState, PageHeader, Table } from "@/components/ui";

interface SegmentRow {
  id: string;
  name: string;
  filters: { field: string; op: string; value?: unknown }[];
  updatedAt: string;
  _count: { campaigns: number };
}

export default function SegmentsPage() {
  const { data } = useFetch<SegmentRow[]>("/api/segments");

  return (
    <div>
      <PageHeader kicker="Audience" title="Segments" actions={<Button href="/segments/new">New segment</Button>} />
      {data && data.length === 0 ? (
        <EmptyState
          title="No segments"
          hint="Segments are saved audience filters — target contacts by attributes or events they performed."
          action={<Button href="/segments/new">Create segment</Button>}
        />
      ) : (
        <div className="rise rise-1">
          <Table head={["Name", "Rules", "Used by", "Updated"]}>
            {data?.map((s) => (
              <tr key={s.id} className="hover:bg-paper-sunken/40">
                <td className="px-4 py-3">
                  <Link href={`/segments/${s.id}`} className="font-medium hover:text-accent">{s.name}</Link>
                </td>
                <td className="px-4 py-3 figure text-xs text-ink-soft">
                  {s.filters.length === 0
                    ? "everyone"
                    : s.filters.map((f) => `${f.field} ${f.op} ${f.value ?? ""}`).join(" AND ")}
                </td>
                <td className="px-4 py-3 figure">{s._count.campaigns} campaigns</td>
                <td className="px-4 py-3 figure text-xs text-ink-faint">{new Date(s.updatedAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </Table>
        </div>
      )}
    </div>
  );
}

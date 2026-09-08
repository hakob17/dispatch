"use client";

import Link from "next/link";
import useFetch from "@/lib/useFetch";
import { Badge, Button, EmptyState, PageHeader, Table } from "@/components/ui";

interface TemplateRow {
  id: string;
  name: string;
  channel: string;
  subject: string | null;
  pushTitle: string | null;
  updatedAt: string;
}

export default function TemplatesPage() {
  const { data } = useFetch<TemplateRow[]>("/api/templates");

  return (
    <div>
      <PageHeader kicker="Content" title="Templates" actions={<Button href="/templates/new">New template</Button>} />
      {data && data.length === 0 ? (
        <EmptyState
          title="No templates"
          hint="Templates hold your message content per channel, with {{variable}} personalization."
          action={<Button href="/templates/new">Create template</Button>}
        />
      ) : (
        <div className="rise rise-1">
          <Table head={["Name", "Channel", "Preview", "Updated"]}>
            {data?.map((t) => (
              <tr key={t.id} className="hover:bg-paper-sunken/40">
                <td className="px-4 py-3">
                  <Link href={`/templates/${t.id}`} className="font-medium hover:text-accent">{t.name}</Link>
                </td>
                <td className="px-4 py-3"><Badge tone="QUEUED">{t.channel}</Badge></td>
                <td className="px-4 py-3 text-ink-soft text-xs truncate max-w-60">{t.subject ?? t.pushTitle ?? "—"}</td>
                <td className="px-4 py-3 figure text-xs text-ink-faint">{new Date(t.updatedAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </Table>
        </div>
      )}
    </div>
  );
}

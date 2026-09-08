"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import useFetch from "@/lib/useFetch";
import { Button, PageHeader } from "@/components/ui";
import SegmentEditor, { FilterRow } from "@/components/SegmentEditor";

export default function EditSegmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data } = useFetch<{ id: string; name: string; filters: FilterRow[]; tags: string[] }>(`/api/segments/${id}`);
  const [saving, setSaving] = useState(false);

  if (!data) return null;

  const save = async (name: string, filters: FilterRow[], tags: string[]) => {
    setSaving(true);
    await fetch(`/api/segments/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, filters, tags }),
    });
    router.push("/segments");
  };

  const remove = async () => {
    if (!confirm("Delete this segment?")) return;
    await fetch(`/api/segments/${id}`, { method: "DELETE" });
    router.push("/segments");
  };

  return (
    <div>
      <PageHeader kicker="Audience" title={data.name} actions={<Button variant="danger" onClick={remove}>Delete</Button>} />
      <SegmentEditor initialName={data.name} initialFilters={data.filters} initialTags={data.tags ?? []} onSave={save} saving={saving} />
    </div>
  );
}

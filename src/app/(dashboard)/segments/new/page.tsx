"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui";
import SegmentEditor, { FilterRow } from "@/components/SegmentEditor";

export default function NewSegmentPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  const save = async (name: string, filters: FilterRow[], tags: string[]) => {
    setSaving(true);
    const res = await fetch("/api/segments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, filters, tags }),
    });
    if (res.ok) router.push("/segments");
    else setSaving(false);
  };

  return (
    <div>
      <PageHeader kicker="Audience" title="New segment" />
      <SegmentEditor onSave={save} saving={saving} />
    </div>
  );
}

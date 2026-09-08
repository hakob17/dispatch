"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui";
import TemplateEditor, { TemplateData } from "@/components/TemplateEditor";

export default function NewTemplatePage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  const save = async (data: TemplateData) => {
    setSaving(true);
    const res = await fetch("/api/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (res.ok) {
      const t = await res.json();
      router.push(`/templates/${t.id}`);
    } else setSaving(false);
  };

  return (
    <div>
      <PageHeader kicker="Content" title="New template" />
      <TemplateEditor onSave={save} saving={saving} />
    </div>
  );
}

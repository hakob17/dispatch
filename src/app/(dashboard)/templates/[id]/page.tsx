"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import useFetch from "@/lib/useFetch";
import { Button, Card, Field, PageHeader, inputCls } from "@/components/ui";
import TemplateEditor, { TemplateData } from "@/components/TemplateEditor";

export default function EditTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data, refresh } = useFetch<TemplateData & { id: string }>(`/api/templates/${id}`);
  const [saving, setSaving] = useState(false);

  if (!data) return null;

  const save = async (t: TemplateData) => {
    setSaving(true);
    await fetch(`/api/templates/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(t),
    });
    setSaving(false);
    refresh();
  };

  const remove = async () => {
    if (!confirm("Delete this template?")) return;
    await fetch(`/api/templates/${id}`, { method: "DELETE" });
    router.push("/templates");
  };

  return (
    <div>
      <PageHeader kicker="Content" title={data.name} actions={<Button variant="danger" onClick={remove}>Delete</Button>} />
      <div className="mb-6">
        <TestSend templateId={id} channel={data.channel} />
      </div>
      <TemplateEditor initial={data} channelLocked onSave={save} saving={saving} />
    </div>
  );
}

function TestSend({ templateId, channel }: { templateId: string; channel: string }) {
  const [toEmail, setToEmail] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const send = async () => {
    setBusy(true);
    setResult(null);
    const res = await fetch("/api/test-send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templateId, toEmail }),
    });
    const json = await res.json();
    setResult(res.ok ? "✓ Sent — check the recipient" : `✗ ${json.error ?? JSON.stringify(json.results)}`);
    setBusy(false);
  };

  return (
    <Card className="rise">
      <div className="flex items-end gap-3">
        <div className="flex-1 max-w-sm">
          <Field
            label="Send a test"
            hint={channel === "EMAIL" ? "Any address (must be verified while SES is sandboxed)" : "Email of a contact that has a subscription on this channel"}
          >
            <input className={inputCls} value={toEmail} onChange={(e) => setToEmail(e.target.value)} placeholder="you@example.com" />
          </Field>
        </div>
        <Button onClick={send} disabled={!toEmail || busy}>{busy ? "Sending…" : "Send test"}</Button>
        {result && <div className={`text-sm pb-2 ${result.startsWith("✓") ? "text-good" : "text-accent"}`}>{result}</div>}
      </div>
    </Card>
  );
}

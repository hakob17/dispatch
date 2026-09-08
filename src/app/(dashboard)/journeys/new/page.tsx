"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import useFetch from "@/lib/useFetch";
import { Button, Field, PageHeader, inputCls } from "@/components/ui";

interface TemplateRow { id: string; name: string; channel: string }
interface SegmentRow { id: string; name: string }

interface StepDraft { delayMinutes: number; channel: string; templateId: string }

export default function NewJourneyPage() {
  const router = useRouter();
  const { data: templates } = useFetch<TemplateRow[]>("/api/templates");
  const { data: segments } = useFetch<SegmentRow[]>("/api/segments");
  const [name, setName] = useState("");
  const [segmentId, setSegmentId] = useState("");
  const [steps, setSteps] = useState<StepDraft[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const channels = useMemo(
    () => Array.from(new Set((templates ?? []).map((t) => t.channel))),
    [templates]
  );
  const templatesFor = (ch: string) => (templates ?? []).filter((t) => t.channel === ch);

  const addStep = () => {
    const ch = channels[0] ?? "EMAIL";
    const tpl = templatesFor(ch)[0];
    if (!tpl) { setErr("Create a template first."); return; }
    setSteps((s) => [...s, { delayMinutes: s.length === 0 ? 0 : 60, channel: ch, templateId: tpl.id }]);
  };

  const update = (i: number, patch: Partial<StepDraft>) =>
    setSteps((ss) => ss.map((s, j) => {
      if (j !== i) return s;
      const next = { ...s, ...patch };
      if (patch.channel) next.templateId = templatesFor(patch.channel)[0]?.id ?? "";
      return next;
    }));

  const save = async () => {
    setBusy(true);
    const res = await fetch("/api/journeys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, segmentId: segmentId || null, steps }),
    });
    if (res.ok) {
      const j = await res.json();
      router.push(`/journeys/${j.id}`);
    } else {
      setErr(JSON.stringify((await res.json()).error));
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader kicker="Orchestration" title="New journey" />
      <div className="rise card p-6 max-w-2xl space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Journey name">
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Welcome series" />
          </Field>
          <Field label="Entry audience">
            <select className={inputCls} value={segmentId} onChange={(e) => setSegmentId(e.target.value)}>
              <option value="">Everyone</option>
              {(segments ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
        </div>

        <div>
          <div className="figure text-[11px] uppercase tracking-[0.18em] text-ink-soft mb-3">Steps</div>
          <div className="space-y-0">
            {steps.map((s, i) => (
              <div key={i} className="relative pl-8 pb-4">
                {/* timeline spine */}
                <div className="absolute left-2.5 top-0 bottom-0 w-px bg-line-strong" />
                <div className="absolute left-0 top-3 w-5 h-5 bg-ink text-paper figure text-[10px] flex items-center justify-center">
                  {i + 1}
                </div>
                <div className="card p-3 flex items-center gap-3">
                  <span className="text-xs text-ink-faint shrink-0">wait</span>
                  <input
                    type="number" min={0}
                    className={inputCls + " w-20"}
                    value={s.delayMinutes}
                    onChange={(e) => update(i, { delayMinutes: Number(e.target.value) })}
                  />
                  <span className="text-xs text-ink-faint shrink-0">min, then send</span>
                  <select className={inputCls + " w-32"} value={s.channel} onChange={(e) => update(i, { channel: e.target.value })}>
                    {channels.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <select className={inputCls + " flex-1"} value={s.templateId} onChange={(e) => update(i, { templateId: e.target.value })}>
                    {templatesFor(s.channel).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                  <button className="text-ink-faint hover:text-accent px-1" onClick={() => setSteps((ss) => ss.filter((_, j) => j !== i))}>×</button>
                </div>
              </div>
            ))}
          </div>
          <Button variant="ghost" small onClick={addStep}>+ Add step</Button>
        </div>

        {err && <div className="text-accent text-sm">{err}</div>}
        <Button onClick={save} disabled={!name || !steps.length || busy}>
          {busy ? "Saving…" : "Save journey (draft)"}
        </Button>
      </div>
    </div>
  );
}

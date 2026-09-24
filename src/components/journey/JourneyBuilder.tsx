"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import useFetch from "@/lib/useFetch";
import { Button, Field, inputCls } from "@/components/ui";
import JourneyFlow, { type Catalogs } from "./JourneyFlow";
import { flatten, type TreeNode } from "./model";

export interface JourneySettings {
  name: string;
  segmentId: string;
  triggerEvent: string;
  exitEvent: string;
}

/** Create or edit (draft) a branching journey. */
export default function JourneyBuilder({ journeyId, initial, initialTree }: { journeyId?: string; initial?: JourneySettings; initialTree?: TreeNode | null }) {
  const router = useRouter();
  const { data: templates } = useFetch<Catalogs["templates"]>("/api/templates");
  const { data: segments } = useFetch<Catalogs["segments"]>("/api/segments");
  const { data: groups } = useFetch<Catalogs["groups"]>("/api/subscription-groups");
  const [s, setS] = useState<JourneySettings>(initial ?? { name: "", segmentId: "", triggerEvent: "", exitEvent: "" });
  const [root, setRoot] = useState<TreeNode | null>(initialTree ?? null);
  const [entry, setEntry] = useState<"segment" | "event">(initial?.triggerEvent ? "event" : "segment");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const catalogs: Catalogs = { templates: templates ?? [], segments: segments ?? [], groups: groups ?? [] };

  const save = async () => {
    if (!root) return;
    setBusy(true);
    setErr(null);
    const body = {
      name: s.name,
      segmentId: s.segmentId || null,
      triggerEvent: entry === "event" ? s.triggerEvent || null : null,
      exitEvent: s.exitEvent || null,
      entryKey: root.key,
      nodes: flatten(root),
    };
    const res = await fetch(journeyId ? `/api/journeys/${journeyId}` : "/api/journeys", {
      method: journeyId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({ error: `Server error (${res.status})` }));
    if (!res.ok) {
      setErr(typeof json.error === "string" ? json.error : describeZod(json.error));
      setBusy(false);
      return;
    }
    router.push(`/journeys/${journeyId ?? json.id}`);
  };

  return (
    <div className="space-y-6">
      <div className="card p-5 max-w-3xl grid grid-cols-2 gap-4">
        <Field label="Journey name">
          <input className={inputCls} value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} placeholder="Onboarding: first week" />
        </Field>
        <Field label="Who enters" hint={entry === "event" ? "Each reader enters once, when they do the event" : "Everyone in the segment when you activate it"}>
          <select className={inputCls} value={entry} onChange={(e) => setEntry(e.target.value as "segment" | "event")}>
            <option value="segment">A segment, when activated</option>
            <option value="event">Readers who do an event</option>
          </select>
        </Field>
        {entry === "event" && (
          <Field label="Entry event">
            <input className={inputCls + " figure"} value={s.triggerEvent} onChange={(e) => setS({ ...s, triggerEvent: e.target.value })} placeholder="signed_up" />
          </Field>
        )}
        <Field label={entry === "event" ? "Only readers in (optional)" : "Segment"}>
          <select className={inputCls} value={s.segmentId} onChange={(e) => setS({ ...s, segmentId: e.target.value })}>
            <option value="">Everyone</option>
            {catalogs.segments.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </Field>
        <Field label="Exit event (optional)" hint="Readers leave the journey as soon as they do this">
          <input className={inputCls + " figure"} value={s.exitEvent} onChange={(e) => setS({ ...s, exitEvent: e.target.value })} placeholder="subscribed" />
        </Field>
      </div>

      <div className="card p-5">
        <h2 className="text-lg mb-4">Flow</h2>
        {!catalogs.templates.length && <p className="text-sm text-ink-soft mb-3">Create a template first — message steps send templates.</p>}
        <JourneyFlow root={root} onChange={setRoot} catalogs={catalogs} />
      </div>

      {err && <div className="text-accent text-sm" role="alert">{err}</div>}
      <Button onClick={save} disabled={!s.name || !root || busy || (entry === "event" && !s.triggerEvent)}>
        {busy ? "Saving…" : journeyId ? "Save changes" : "Save journey (draft)"}
      </Button>
    </div>
  );
}

function describeZod(e: { formErrors?: string[]; fieldErrors?: Record<string, string[]> } | undefined): string {
  if (!e) return "Could not save";
  return [...(e.formErrors ?? []), ...Object.entries(e.fieldErrors ?? {}).map(([k, v]) => `${k}: ${v.join(", ")}`)].join("; ") || "Could not save";
}

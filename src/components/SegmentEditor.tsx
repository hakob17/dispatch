"use client";

import { useEffect, useState } from "react";
import { Button, Field, inputCls } from "@/components/ui";

export interface FilterRow {
  field: string;
  op: "eq" | "neq" | "contains" | "exists" | "gt" | "lt";
  value?: string;
}

const FIELD_PRESETS = ["email", "firstName", "lastName", "phone"];
const OPS: FilterRow["op"][] = ["eq", "neq", "contains", "exists", "gt", "lt"];
const OP_LABELS: Record<string, string> = {
  eq: "equals", neq: "does not equal", contains: "contains", exists: "exists", gt: ">", lt: "<",
};

export default function SegmentEditor({
  initialName = "",
  initialFilters = [],
  initialTags = [],
  onSave,
  saving,
}: {
  initialName?: string;
  initialFilters?: FilterRow[];
  initialTags?: string[];
  onSave: (name: string, filters: FilterRow[], tags: string[]) => void;
  saving?: boolean;
}) {
  const [name, setName] = useState(initialName);
  const [filters, setFilters] = useState<FilterRow[]>(initialFilters);
  const [tags, setTags] = useState(initialTags.join(", "));
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    const t = setTimeout(async () => {
      const res = await fetch("/api/segments/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filters }),
      });
      const json = await res.json();
      setCount(res.ok ? json.count : null);
    }, 400);
    return () => clearTimeout(t);
  }, [filters]);

  const update = (i: number, patch: Partial<FilterRow>) =>
    setFilters((fs) => fs.map((f, j) => (j === i ? { ...f, ...patch } : f)));

  return (
    <div className="card p-5 rise">
      <div className="grid grid-cols-2 gap-4 max-w-2xl mb-5">
        <Field label="Segment name">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Pro-plan users" />
        </Field>
        <Field label="Tags" hint="Comma-separated">
          <input className={inputCls} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="core, trial" />
        </Field>
      </div>

      <div className="figure text-[11px] uppercase tracking-[0.18em] text-ink-soft mb-3">
        Match contacts where <span className="text-accent">all</span> rules hold
      </div>

      <div className="space-y-2">
        {filters.map((f, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              className={inputCls + " w-56"}
              list="field-presets"
              value={f.field}
              placeholder="field — e.g. attributes.plan"
              onChange={(e) => update(i, { field: e.target.value })}
            />
            <select className={inputCls + " w-40"} value={f.op} onChange={(e) => update(i, { op: e.target.value as FilterRow["op"] })}>
              {OPS.map((op) => <option key={op} value={op}>{OP_LABELS[op]}</option>)}
            </select>
            {f.op !== "exists" && (
              <input
                className={inputCls + " w-48"}
                value={f.value ?? ""}
                placeholder="value"
                onChange={(e) => update(i, { value: e.target.value })}
              />
            )}
            <button
              className="text-ink-faint hover:text-accent px-2 text-lg leading-none"
              onClick={() => setFilters((fs) => fs.filter((_, j) => j !== i))}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <datalist id="field-presets">
        {FIELD_PRESETS.map((f) => <option key={f} value={f} />)}
        <option value="attributes.plan" />
        <option value="event.signup" />
      </datalist>

      <div className="mt-3">
        <Button variant="ghost" small onClick={() => setFilters((fs) => [...fs, { field: "email", op: "exists" }])}>
          + Add rule
        </Button>
        <span className="text-xs text-ink-faint ml-3">
          Fields: standard, <span className="figure">attributes.&lt;key&gt;</span>, or{" "}
          <span className="figure">event.&lt;name&gt;</span> (performed / not performed)
        </span>
      </div>

      <div className="flex items-center gap-4 mt-6 pt-4 border-t border-line">
        <Button onClick={() => onSave(name, filters, tags.split(",").map((t) => t.trim()).filter(Boolean))} disabled={!name || saving}>
          {saving ? "Saving…" : "Save segment"}
        </Button>
        <div className="figure text-sm text-ink-soft">
          {count === null ? "…" : <><span className="text-accent text-lg">{count.toLocaleString()}</span> matching contacts</>}
        </div>
      </div>
    </div>
  );
}

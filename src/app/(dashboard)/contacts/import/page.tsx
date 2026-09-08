"use client";

import { useState } from "react";
import Papa from "papaparse";
import { Button, Card, PageHeader, inputCls } from "@/components/ui";

const TARGETS = ["skip", "email", "firstName", "lastName", "phone"] as const;

export default function ImportPage() {
  const [csv, setCsv] = useState<string>("");
  const [columns, setColumns] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ created: number; updated: number; skipped: number; errors: string[] } | null>(null);
  const [busy, setBusy] = useState(false);

  const onFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result);
      setCsv(text);
      const parsed = Papa.parse<Record<string, string>>(text, { header: true, preview: 1 });
      const cols = parsed.meta.fields ?? [];
      setColumns(cols);
      // auto-map obvious columns
      const auto: Record<string, string> = {};
      for (const col of cols) {
        const l = col.toLowerCase().replace(/[^a-z]/g, "");
        if (l.includes("email")) auto[col] = "email";
        else if (l === "firstname" || l === "first") auto[col] = "firstName";
        else if (l === "lastname" || l === "last") auto[col] = "lastName";
        else if (l.includes("phone")) auto[col] = "phone";
        else auto[col] = `attributes.${col}`;
      }
      setMapping(auto);
      setResult(null);
    };
    reader.readAsText(file);
  };

  const run = async () => {
    setBusy(true);
    const res = await fetch("/api/contacts/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csv, mapping }),
    });
    setResult(await res.json());
    setBusy(false);
  };

  return (
    <div>
      <PageHeader kicker="Audience" title="Import contacts" />
      <Card className="rise rise-1 mb-6">
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
          className="text-sm"
        />
        <div className="text-xs text-ink-faint mt-2">
          CSV with a header row. Rows are upserted by email; unmapped columns become custom attributes.
        </div>
      </Card>

      {columns.length > 0 && (
        <Card className="rise rise-2 mb-6">
          <div className="figure text-[11px] uppercase tracking-[0.18em] text-ink-soft mb-4">Column mapping</div>
          <div className="grid grid-cols-2 gap-3 max-w-2xl">
            {columns.map((col) => (
              <div key={col} className="flex items-center gap-3">
                <span className="figure text-sm w-40 truncate">{col}</span>
                <span className="text-ink-faint">→</span>
                <select
                  className={inputCls + " flex-1"}
                  value={mapping[col] ?? "skip"}
                  onChange={(e) => setMapping((m) => ({ ...m, [col]: e.target.value }))}
                >
                  {TARGETS.map((t) => <option key={t} value={t}>{t}</option>)}
                  <option value={`attributes.${col}`}>attributes.{col}</option>
                </select>
              </div>
            ))}
          </div>
          <div className="mt-5">
            <Button onClick={run} disabled={busy}>{busy ? "Importing…" : "Run import"}</Button>
          </div>
        </Card>
      )}

      {result && (
        <Card className="rise">
          <div className="figure text-2xl">
            <span className="text-good">{result.created} created</span> ·{" "}
            <span className="text-teal">{result.updated} updated</span> ·{" "}
            <span className="text-ink-faint">{result.skipped} skipped</span>
          </div>
          {result.errors.length > 0 && (
            <ul className="text-xs text-accent mt-3 space-y-1">
              {result.errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}

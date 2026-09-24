"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface Result {
  type: string;
  id: string;
  title: string;
  sub: string;
  href: string;
}

const TYPE_ICON: Record<string, string> = {
  contact: "@",
  campaign: "▶",
  segment: "◫",
  template: "✎",
  journey: "⤳",
};

export default function CommandK() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset the palette as it opens, in the event handler rather than an effect
  const toggle = () =>
    setOpen((o) => {
      if (!o) {
        setQ("");
        setResults([]);
        setSel(0);
      }
      return !o;
    });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        toggle();
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 30);
  }, [open]);

  const active = open && q.trim().length >= 2;
  const shown = active ? results : [];

  useEffect(() => {
    if (!active) return;
    const t = setTimeout(async () => {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      if (res.ok) {
        const json = await res.json();
        setResults(json.results);
        setSel(0);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [q, active]);

  const go = useCallback(
    (r: Result) => {
      setOpen(false);
      router.push(r.href);
    },
    [router]
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-ink/30 backdrop-blur-[2px] flex items-start justify-center pt-[18vh]" onClick={() => setOpen(false)}>
      <div className="card w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="w-full px-4 py-3.5 text-base bg-transparent focus:outline-none border-b border-line"
          placeholder="Search contacts, campaigns, segments, templates…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(shown.length - 1, s + 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
            if (e.key === "Enter" && shown[sel]) go(shown[sel]);
          }}
        />
        <div className="max-h-80 overflow-y-auto">
          {q.trim().length >= 2 && shown.length === 0 && (
            <div className="px-4 py-6 text-sm text-ink-faint text-center">No matches.</div>
          )}
          {shown.map((r, i) => (
            <button
              key={`${r.type}-${r.id}`}
              onClick={() => go(r)}
              onMouseEnter={() => setSel(i)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm ${i === sel ? "bg-accent-wash" : ""}`}
            >
              <span className="figure text-accent w-4 text-center">{TYPE_ICON[r.type] ?? "·"}</span>
              <span className="flex-1 truncate">{r.title}</span>
              <span className="figure text-[10px] uppercase tracking-wider text-ink-faint">{r.type}{r.sub ? ` · ${r.sub}` : ""}</span>
            </button>
          ))}
        </div>
        <div className="figure text-[10px] text-ink-faint px-4 py-2 border-t border-line">↑↓ navigate · ↵ open · esc close</div>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import useFetch from "@/lib/useFetch";
import { Button, Card, EmptyState, Field, PageHeader, inputCls } from "@/components/ui";

export default function ContentPage() {
  const [tab, setTab] = useState<"media" | "blocks">("media");
  return (
    <div>
      <PageHeader
        kicker="Creative assets"
        title="Content"
        actions={
          <div className="flex gap-0 border border-line-strong">
            {(["media", "blocks"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-1.5 text-sm ${tab === t ? "bg-ink text-paper" : "text-ink-soft hover:text-ink"}`}
              >
                {t === "media" ? "Media library" : "Content blocks"}
              </button>
            ))}
          </div>
        }
      />
      {tab === "media" ? <MediaLibrary /> : <ContentBlocks />}
    </div>
  );
}

interface Asset { id: string; filename: string; path: string; mime: string; size: number; createdAt: string }

function MediaLibrary() {
  const { data, refresh } = useFetch<Asset[]>("/api/media");
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const upload = async (file: File) => {
    setErr(null);
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/media", { method: "POST", body: form });
    if (!res.ok) setErr((await res.json()).error);
    refresh();
  };

  const copy = (path: string) => {
    navigator.clipboard.writeText(`${window.location.origin}${path}`);
    setCopied(path);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div className="rise">
      <Card className="mb-6">
        <div className="flex items-center gap-4">
          <input type="file" accept="image/*" className="text-sm" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          <span className="text-xs text-ink-faint">PNG / JPEG / GIF / WebP / SVG, up to 5 MB. Copy the URL into email templates.</span>
        </div>
        {err && <div className="text-accent text-sm mt-2">{err}</div>}
      </Card>

      {data && data.length === 0 ? (
        <EmptyState title="No assets yet" hint="Upload images to use in your email templates." />
      ) : (
        <div className="grid grid-cols-4 gap-4">
          {data?.map((a) => (
            <div key={a.id} className="card overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={a.path} alt={a.filename} className="w-full h-32 object-cover bg-paper-sunken" />
              <div className="p-3">
                <div className="text-xs font-medium truncate">{a.filename}</div>
                <div className="figure text-[10px] text-ink-faint mt-0.5">{(a.size / 1024).toFixed(0)} KB</div>
                <div className="flex gap-2 mt-2">
                  <Button small variant="ghost" onClick={() => copy(a.path)}>
                    {copied === a.path ? "✓ copied" : "Copy URL"}
                  </Button>
                  <Button small variant="danger" onClick={async () => {
                    if (!confirm(`Delete ${a.filename}?`)) return;
                    await fetch(`/api/media/${a.id}`, { method: "DELETE" });
                    refresh();
                  }}>×</Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface Block { id: string; name: string; content: string; updatedAt: string }

function ContentBlocks() {
  const { data, refresh } = useFetch<Block[]>("/api/content-blocks");
  const [editing, setEditing] = useState<Block | null>(null);
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const startNew = () => {
    setEditing(null);
    setName("");
    setContent("<p>Shared footer, header, or promo block…</p>");
  };

  const save = async () => {
    setErr(null);
    const res = editing
      ? await fetch(`/api/content-blocks/${editing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, content }),
        })
      : await fetch("/api/content-blocks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, content }),
        });
    if (!res.ok) {
      setErr(JSON.stringify((await res.json()).error));
      return;
    }
    setName(""); setContent(""); setEditing(null);
    refresh();
  };

  return (
    <div className="rise grid grid-cols-2 gap-6">
      <div>
        {data && data.length === 0 && (
          <EmptyState title="No content blocks" hint="Reusable HTML snippets — include them in any email with {{content_block.name}}." />
        )}
        <div className="space-y-3">
          {data?.map((b) => (
            <Card key={b.id} className="flex items-center justify-between">
              <div className="min-w-0">
                <div className="figure text-sm text-accent">{"{{content_block." + b.name + "}}"}</div>
                <div className="text-xs text-ink-faint truncate mt-1">{b.content.replace(/<[^>]+>/g, " ").slice(0, 80)}</div>
              </div>
              <div className="flex gap-2 shrink-0 ml-3">
                <Button small variant="ghost" onClick={() => { setEditing(b); setName(b.name); setContent(b.content); }}>Edit</Button>
                <Button small variant="danger" onClick={async () => {
                  if (!confirm(`Delete block "${b.name}"?`)) return;
                  await fetch(`/api/content-blocks/${b.id}`, { method: "DELETE" });
                  refresh();
                }}>×</Button>
              </div>
            </Card>
          ))}
        </div>
        <div className="mt-4">
          <Button variant="ghost" small onClick={startNew}>+ New block</Button>
        </div>
      </div>

      <Card>
        <div className="figure text-[11px] uppercase tracking-[0.18em] text-ink-soft mb-4">
          {editing ? `Editing "${editing.name}"` : "New content block"}
        </div>
        <div className="space-y-4">
          <Field label="Name" hint="Used as {{content_block.<name>}} — letters, digits, _ and -">
            <input className={inputCls + " figure"} value={name} onChange={(e) => setName(e.target.value)} placeholder="footer" />
          </Field>
          <Field label="HTML content">
            <textarea className={inputCls + " figure text-xs h-48"} value={content} onChange={(e) => setContent(e.target.value)} />
          </Field>
          {err && <div className="text-accent text-sm">{err}</div>}
          <Button onClick={save} disabled={!name || !content}>{editing ? "Save changes" : "Create block"}</Button>
        </div>
      </Card>
    </div>
  );
}

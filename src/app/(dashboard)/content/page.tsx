"use client";

import { useState } from "react";
import useFetch from "@/lib/useFetch";
import { Badge, Button, Card, EmptyState, Field, PageHeader, inputCls } from "@/components/ui";

export default function ContentPage() {
  const [tab, setTab] = useState<"media" | "blocks" | "articles">("media");
  return (
    <div>
      <PageHeader
        kicker="Creative assets"
        title="Content"
        actions={
          <div className="flex gap-0 border border-line-strong">
            {(["media", "blocks", "articles"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-1.5 text-sm ${tab === t ? "bg-ink text-paper" : "text-ink-soft hover:text-ink"}`}
              >
                {t === "media" ? "Media library" : t === "blocks" ? "Content blocks" : "Articles & feeds"}
              </button>
            ))}
          </div>
        }
      />
      {tab === "media" ? <MediaLibrary /> : tab === "blocks" ? <ContentBlocks /> : <ArticlesAndFeeds />}
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
          <input type="file" accept="image/*" className="text-sm" aria-label="Upload an image" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
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

interface Feed {
  id: string;
  name: string;
  url: string;
  section: string | null;
  pollMinutes: number;
  autoCampaignId: string | null;
  isActive: boolean;
  lastFetchedAt: string | null;
  lastError: string | null;
  itemsIngested: number;
}
interface Article { id: string; title: string; url: string; section: string | null; publishedAt: string; imageUrl: string | null; score?: number }

function ArticlesAndFeeds() {
  const { data: feeds, refresh } = useFetch<Feed[]>("/api/content-feeds", 15000);
  const { data: catalog } = useFetch<{ total: number; items: Article[]; trending: Article[] }>("/api/content-items", 15000);
  const { data: campaigns } = useFetch<{ id: string; name: string; channel: string }[]>("/api/campaigns");
  const [form, setForm] = useState({ name: "", url: "", section: "", pollMinutes: 5, autoCampaignId: "" });
  const [err, setErr] = useState<string | null>(null);

  const add = async () => {
    setErr(null);
    const res = await fetch("/api/content-feeds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, section: form.section || null, autoCampaignId: form.autoCampaignId || null }),
    });
    if (!res.ok) return setErr(JSON.stringify((await res.json()).error));
    setForm({ name: "", url: "", section: "", pollMinutes: 5, autoCampaignId: "" });
    refresh();
  };
  const patch = async (id: string, body: object) => {
    await fetch(`/api/content-feeds/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    refresh();
  };
  const campaignName = (id: string | null) => campaigns?.find((c) => c.id === id)?.name ?? "—";

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_22rem] gap-6">
      <div className="space-y-6">
        <Card className="rise">
          <h2 className="text-xl mb-1">Feeds</h2>
          <p className="text-sm text-ink-soft mb-4">
            RSS, Atom or JSON Feed URLs, checked on a schedule. New articles go into the catalog for recommendations. With an
            auto-send campaign, each new article launches it; use <span className="figure text-xs">{"{{item.title}}"}</span> and{" "}
            <span className="figure text-xs">{"{{item.url}}"}</span> in its template. The first check only imports, so adding a feed never
            sends yesterday&apos;s news.
          </p>
          {(feeds ?? []).map((f) => (
            <div key={f.id} className={`py-2.5 border-b border-line text-sm ${f.isActive ? "" : "opacity-50"}`}>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <span className="font-medium">{f.name}</span>
                  {f.autoCampaignId && <span className="ml-2"><Badge tone="RUNNING">auto-send</Badge></span>}
                  <div className="figure text-xs text-ink-faint truncate">{f.url}</div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button small variant="ghost" onClick={() => patch(f.id, { pollNow: true })}>check now</Button>
                  <Button small variant="ghost" onClick={() => patch(f.id, { isActive: !f.isActive })}>{f.isActive ? "pause" : "resume"}</Button>
                  <Button small variant="danger" onClick={async () => { await fetch(`/api/content-feeds/${f.id}`, { method: "DELETE" }); refresh(); }}>delete</Button>
                </div>
              </div>
              <div className="figure text-xs text-ink-faint mt-1">
                every {f.pollMinutes} min · {f.itemsIngested} imported · sends: {campaignName(f.autoCampaignId)} ·{" "}
                {f.lastFetchedAt ? `checked ${new Date(f.lastFetchedAt).toLocaleTimeString()}` : "not checked yet"}
                {f.lastError && <span className="text-accent"> · {f.lastError}</span>}
              </div>
            </div>
          ))}
          <div className="grid grid-cols-2 gap-3 mt-4">
            <Field label="Name"><input id="feed-name" className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="World news" /></Field>
            <Field label="Feed URL"><input id="feed-url" className={inputCls + " figure text-xs"} value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://…/rss.xml" /></Field>
            <Field label="Section (optional)" hint="Used when an item has no category"><input id="feed-section" className={inputCls} value={form.section} onChange={(e) => setForm({ ...form, section: e.target.value })} placeholder="world" /></Field>
            <Field label="Check every (minutes)"><input id="feed-poll" type="number" min={1} className={inputCls + " figure"} value={form.pollMinutes} onChange={(e) => setForm({ ...form, pollMinutes: Number(e.target.value) })} /></Field>
            <Field label="Auto-send campaign (optional)" hint="Launched once per new article">
              <select id="feed-campaign" className={inputCls} value={form.autoCampaignId} onChange={(e) => setForm({ ...form, autoCampaignId: e.target.value })}>
                <option value="">Don&apos;t send — catalog only</option>
                {(campaigns ?? []).map((c) => <option key={c.id} value={c.id}>{c.name} ({c.channel})</option>)}
              </select>
            </Field>
          </div>
          {err && <div className="text-accent text-sm mt-2">{err}</div>}
          <div className="mt-3"><Button onClick={add} disabled={!form.name || !form.url}>Add feed</Button></div>
        </Card>

        <Card className="rise rise-2">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-xl">Latest articles</h2>
            <span className="figure text-xs text-ink-faint">{catalog?.total ?? 0} in catalog</span>
          </div>
          {!catalog?.items.length ? (
            <EmptyState title="No articles yet" hint="Add a feed, or POST them from your CMS to /api/v1/content/items." />
          ) : (
            catalog.items.map((a) => (
              <div key={a.id} className="py-2 border-b border-line text-sm flex justify-between gap-3">
                <a href={a.url} target="_blank" rel="noreferrer" className="hover:underline min-w-0 truncate">{a.title}</a>
                <span className="figure text-xs text-ink-faint shrink-0">{a.section ?? "—"} · {new Date(a.publishedAt).toLocaleString()}</span>
              </div>
            ))
          )}
        </Card>
      </div>

      <Card className="rise rise-3 h-fit">
        <h2 className="text-xl mb-1">Trending now</h2>
        <p className="text-xs text-ink-faint mb-3">
          Reads in the last 24 h × freshness. Personal picks add each reader&apos;s section and tag history: use{" "}
          <span className="figure">{"{{recommendation.1.title}}"}</span> in a template.
        </p>
        {(catalog?.trending ?? []).map((a, i) => (
          <div key={a.id} className="py-2 border-b border-line text-sm">
            <span className="figure text-xs text-ink-faint mr-2">{i + 1}</span>
            {a.title}
            <div className="figure text-[10px] text-ink-faint">{a.section ?? "—"} · score {a.score}</div>
          </div>
        ))}
        {!catalog?.trending?.length && <div className="text-sm text-ink-faint">Nothing yet.</div>}
      </Card>
    </div>
  );
}

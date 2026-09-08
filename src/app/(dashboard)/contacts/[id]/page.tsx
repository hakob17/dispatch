"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import useFetch from "@/lib/useFetch";
import { Badge, Button, Card, Field, PageHeader, Table, inputCls } from "@/components/ui";

interface ContactDetail {
  id: string;
  email: string | null;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  attributes: Record<string, unknown>;
  createdAt: string;
  subscriptions: { id: string; channel: string; endpoint: string; isActive: boolean; createdAt: string }[];
  events: { id: string; name: string; properties: Record<string, unknown>; createdAt: string }[];
  messages: { id: string; channel: string; status: string; createdAt: string; campaign: { name: string } | null }[];
}

export default function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data, refresh } = useFetch<ContactDetail>(`/api/contacts/${id}`);
  const [editing, setEditing] = useState(false);

  if (!data) return null;

  const remove = async () => {
    if (!confirm("Delete this contact and all their history?")) return;
    await fetch(`/api/contacts/${id}`, { method: "DELETE" });
    router.push("/contacts");
  };

  return (
    <div>
      <PageHeader
        kicker="Contact"
        title={data.email ?? [data.firstName, data.lastName].filter(Boolean).join(" ") ?? "Anonymous"}
        actions={
          <>
            <Button variant="ghost" onClick={() => setEditing((e) => !e)}>{editing ? "Close" : "Edit"}</Button>
            <Button variant="danger" onClick={remove}>Delete</Button>
          </>
        }
      />

      {editing && <EditForm contact={data} onSaved={() => { setEditing(false); refresh(); }} />}

      <div className="grid grid-cols-3 gap-4 mb-8">
        <Card className="rise rise-1">
          <div className="figure text-[11px] uppercase tracking-[0.18em] text-ink-soft mb-3">Profile</div>
          <dl className="text-sm space-y-2">
            <div className="flex justify-between gap-2"><dt className="text-ink-faint">Email</dt><dd className="truncate">{data.email ?? "—"}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-ink-faint">Name</dt><dd>{[data.firstName, data.lastName].filter(Boolean).join(" ") || "—"}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-ink-faint">Added</dt><dd className="figure text-xs">{new Date(data.createdAt).toLocaleString()}</dd></div>
          </dl>
        </Card>
        <Card className="rise rise-2">
          <div className="figure text-[11px] uppercase tracking-[0.18em] text-ink-soft mb-3">Attributes</div>
          <pre className="figure text-xs text-ink-soft overflow-auto max-h-36">{JSON.stringify(data.attributes, null, 2)}</pre>
        </Card>
        <Card className="rise rise-3">
          <div className="figure text-[11px] uppercase tracking-[0.18em] text-ink-soft mb-3">Push subscriptions</div>
          {data.subscriptions.length === 0 && <div className="text-sm text-ink-faint">None — visit the demo page to subscribe this browser.</div>}
          <ul className="space-y-2">
            {data.subscriptions.map((s) => (
              <li key={s.id} className="text-xs flex items-center gap-2">
                <Badge tone={s.isActive ? "ACTIVE" : "FAILED"}>{s.channel}</Badge>
                <span className="figure text-ink-faint truncate">{s.endpoint.slice(0, 40)}…</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="rise rise-3">
          <h2 className="text-lg mb-3">Message history</h2>
          <Table head={["Campaign", "Channel", "Status", "When"]}>
            {data.messages.map((m) => (
              <tr key={m.id}>
                <td className="px-4 py-2.5">{m.campaign?.name ?? <span className="text-ink-faint italic">test / journey</span>}</td>
                <td className="px-4 py-2.5 figure text-xs">{m.channel}</td>
                <td className="px-4 py-2.5"><Badge>{m.status}</Badge></td>
                <td className="px-4 py-2.5 figure text-xs text-ink-faint">{new Date(m.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </Table>
        </div>
        <div className="rise rise-4">
          <h2 className="text-lg mb-3">Events</h2>
          <Table head={["Event", "Properties", "When"]}>
            {data.events.map((e) => (
              <tr key={e.id}>
                <td className="px-4 py-2.5 font-medium">{e.name}</td>
                <td className="px-4 py-2.5 figure text-xs text-ink-faint truncate max-w-40">{JSON.stringify(e.properties)}</td>
                <td className="px-4 py-2.5 figure text-xs text-ink-faint">{new Date(e.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </Table>
        </div>
      </div>
    </div>
  );
}

function EditForm({ contact, onSaved }: { contact: ContactDetail; onSaved: () => void }) {
  const [email, setEmail] = useState(contact.email ?? "");
  const [firstName, setFirstName] = useState(contact.firstName ?? "");
  const [lastName, setLastName] = useState(contact.lastName ?? "");
  const [attrs, setAttrs] = useState(JSON.stringify(contact.attributes, null, 2));
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    let attributes;
    try {
      attributes = JSON.parse(attrs);
    } catch {
      setErr("Invalid JSON");
      return;
    }
    const res = await fetch(`/api/contacts/${contact.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email || null, firstName: firstName || null, lastName: lastName || null, attributes }),
    });
    if (res.ok) onSaved();
    else setErr("Save failed");
  };

  return (
    <div className="card p-5 mb-6 rise">
      <div className="grid grid-cols-3 gap-4">
        <Field label="Email"><input className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="First name"><input className={inputCls} value={firstName} onChange={(e) => setFirstName(e.target.value)} /></Field>
        <Field label="Last name"><input className={inputCls} value={lastName} onChange={(e) => setLastName(e.target.value)} /></Field>
      </div>
      <div className="mt-4">
        <Field label="Attributes (JSON)">
          <textarea className={inputCls + " figure text-xs h-28"} value={attrs} onChange={(e) => setAttrs(e.target.value)} />
        </Field>
      </div>
      {err && <div className="text-accent text-sm mt-3">{err}</div>}
      <div className="mt-4"><Button onClick={save}>Save changes</Button></div>
    </div>
  );
}

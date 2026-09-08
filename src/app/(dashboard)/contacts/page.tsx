"use client";

import { useState } from "react";
import Link from "next/link";
import useFetch from "@/lib/useFetch";
import { Button, EmptyState, Field, PageHeader, Table, inputCls } from "@/components/ui";

interface ContactRow {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  createdAt: string;
  _count: { subscriptions: number; messages: number };
}

export default function ContactsPage() {
  const [q, setQ] = useState("");
  const [showNew, setShowNew] = useState(false);
  const { data, refresh } = useFetch<{ contacts: ContactRow[]; total: number }>(
    `/api/contacts?q=${encodeURIComponent(q)}`
  );

  return (
    <div>
      <PageHeader
        kicker="Audience"
        title="Contacts"
        actions={
          <>
            <Button variant="ghost" href="/contacts/import">Import CSV</Button>
            <Button onClick={() => setShowNew((s) => !s)}>New contact</Button>
          </>
        }
      />

      {showNew && <NewContactForm onDone={() => { setShowNew(false); refresh(); }} />}

      <div className="rise rise-1 mb-4">
        <input
          className={inputCls + " max-w-sm"}
          placeholder="Search email or name…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {data && <span className="figure text-xs text-ink-faint ml-3">{data.total.toLocaleString()} total</span>}
      </div>

      {data && data.contacts.length === 0 ? (
        <EmptyState title="No contacts" hint="Add one manually or import a CSV to build your audience." />
      ) : (
        <div className="rise rise-2">
          <Table head={["Email", "Name", "Push subs", "Messages", "Added"]}>
            {data?.contacts.map((c) => (
              <tr key={c.id} className="hover:bg-paper-sunken/40">
                <td className="px-4 py-3">
                  <Link href={`/contacts/${c.id}`} className="text-ink font-medium hover:text-accent">
                    {c.email ?? <span className="text-ink-faint italic">push-only</span>}
                  </Link>
                </td>
                <td className="px-4 py-3 text-ink-soft">{[c.firstName, c.lastName].filter(Boolean).join(" ") || "—"}</td>
                <td className="px-4 py-3 figure">{c._count.subscriptions}</td>
                <td className="px-4 py-3 figure">{c._count.messages}</td>
                <td className="px-4 py-3 figure text-xs text-ink-faint">{new Date(c.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </Table>
        </div>
      )}
    </div>
  );
}

function NewContactForm({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [attrs, setAttrs] = useState("{}");
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    let attributes = {};
    try {
      attributes = JSON.parse(attrs || "{}");
    } catch {
      setErr("Attributes must be valid JSON");
      return;
    }
    const res = await fetch("/api/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email || null, firstName: firstName || null, lastName: lastName || null, attributes }),
    });
    if (res.ok) onDone();
    else setErr(JSON.stringify((await res.json()).error));
  };

  return (
    <div className="card p-5 mb-6 rise">
      <div className="grid grid-cols-3 gap-4">
        <Field label="Email"><input className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="First name"><input className={inputCls} value={firstName} onChange={(e) => setFirstName(e.target.value)} /></Field>
        <Field label="Last name"><input className={inputCls} value={lastName} onChange={(e) => setLastName(e.target.value)} /></Field>
      </div>
      <div className="mt-4">
        <Field label="Custom attributes (JSON)" hint='e.g. {"plan": "pro", "city": "Yerevan"}'>
          <textarea className={inputCls + " figure text-xs h-20"} value={attrs} onChange={(e) => setAttrs(e.target.value)} />
        </Field>
      </div>
      {err && <div className="text-accent text-sm mt-3">{err}</div>}
      <div className="mt-4"><Button onClick={submit}>Save contact</Button></div>
    </div>
  );
}

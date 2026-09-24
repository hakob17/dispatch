"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import useFetch from "@/lib/useFetch";
import { Button, Field, PageHeader, inputCls } from "@/components/ui";
import TemplatePreview, { PreviewableTemplate } from "@/components/TemplatePreview";

interface ChannelStatus { channel: string; label: string; configured: boolean; hint: string }
interface TemplateRow extends PreviewableTemplate { id: string; name: string; channel: string }
interface SegmentRow { id: string; name: string }

const STEPS = ["Channel", "Content", "Audience", "Launch"];

export default function NewCampaignPage() {
  const router = useRouter();
  const { data: channels } = useFetch<ChannelStatus[]>("/api/channels");
  const { data: templates } = useFetch<TemplateRow[]>("/api/templates");
  const { data: segments } = useFetch<SegmentRow[]>("/api/segments");

  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [channel, setChannel] = useState<string | null>(null);
  const [allPushPlatforms, setAllPushPlatforms] = useState(false);
  const isPushChannel = channel === "FCM" || channel === "APNS" || channel === "WEB_PUSH";
  const [variants, setVariants] = useState<{ templateId: string; name: string; weight: number }[]>([]);
  const [segmentId, setSegmentId] = useState<string | "">("");
  const [when, setWhen] = useState<"now" | "later">("now");
  const [scheduledAt, setScheduledAt] = useState("");
  const [trigger, setTrigger] = useState<"SCHEDULED" | "EVENT">("SCHEDULED");
  const [triggerEvent, setTriggerEvent] = useState("");
  const [recurrence, setRecurrence] = useState<"NONE" | "DAILY" | "WEEKLY">("NONE");
  const [conversionEvent, setConversionEvent] = useState("");
  const [controlGroupPct, setControlGroupPct] = useState(0);
  const [subscriptionGroupId, setSubscriptionGroupId] = useState("");
  const [bypassDeliveryRules, setBypassDeliveryRules] = useState(false);
  const [sendTimeOptimization, setSendTimeOptimization] = useState(false);
  const [tags, setTags] = useState("");
  const { data: subGroups } = useFetch<{ id: string; name: string; kind: "newsletter" | "topic"; subscribers: number }[]>("/api/subscription-groups");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [audience, setAudience] = useState<{ matching: number; reachable: number; devices: { platform: string; count: number }[] } | null>(null);

  const channelTemplates = useMemo(
    () => (templates ?? []).filter((t) => t.channel === channel),
    [templates, channel]
  );

  // Same audience the worker resolves at launch: segment ∧ newsletter subscribers ∧ reachable on the channel
  useEffect(() => {
    if (step !== 2) return;
    let live = true; // the previous numbers stay until the new ones arrive
    fetch("/api/campaigns/audience", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel, allPushPlatforms: isPushChannel && allPushPlatforms, segmentId: segmentId || null, subscriptionGroupId: subscriptionGroupId || null }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((a) => live && setAudience(a));
    return () => { live = false; };
  }, [step, channel, isPushChannel, allPushPlatforms, segmentId, subscriptionGroupId]);

  const launch = async () => {
    setBusy(true);
    setError(null);
    const createRes = await fetch("/api/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        channel,
        allPushPlatforms: isPushChannel && allPushPlatforms,
        segmentId: segmentId || null,
        variants,
        trigger,
        triggerEvent: trigger === "EVENT" ? triggerEvent : null,
        recurrence: trigger === "EVENT" ? "NONE" : recurrence,
        conversionEvent: conversionEvent || null,
        controlGroupPct,
        subscriptionGroupId: subscriptionGroupId || null,
        bypassDeliveryRules,
        sendTimeOptimization: sendTimeOptimization && !bypassDeliveryRules && trigger === "SCHEDULED",
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      }),
    });
    const created = await createRes.json();
    if (!createRes.ok) { setError(JSON.stringify(created.error)); setBusy(false); return; }
    const launchRes = await fetch(`/api/campaigns/${created.id}/launch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ when: when === "now" ? "now" : new Date(scheduledAt).toISOString() }),
    });
    if (!launchRes.ok) { setError((await launchRes.json()).error); setBusy(false); return; }
    router.push(`/campaigns/${created.id}`);
  };

  const totalWeight = variants.reduce((s, v) => s + v.weight, 0);

  return (
    <div>
      <PageHeader kicker="Messaging" title="New campaign" />

      {/* step rail */}
      <div className="rise flex gap-0 mb-8 border border-line-strong bg-paper-raised">
        {STEPS.map((s, i) => (
          <button
            key={s}
            onClick={() => i < step && setStep(i)}
            className={`flex-1 px-4 py-3 text-sm text-left border-r border-line last:border-r-0 transition-colors ${
              i === step ? "bg-ink text-paper" : i < step ? "text-ink hover:bg-paper-sunken" : "text-ink-faint"
            }`}
          >
            <span className="figure text-[10px] block">{String(i + 1).padStart(2, "0")}</span>
            {s}
          </button>
        ))}
      </div>

      {step === 0 && (
        <div className="rise space-y-5">
          <div className="max-w-sm">
            <Field label="Campaign name">
              <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="July product update" />
            </Field>
          </div>

          <div>
            <div className="figure text-[11px] uppercase tracking-[0.15em] text-ink-soft mb-2">Delivery type</div>
            <div className="flex gap-3 max-w-lg">
              <label className={`flex-1 card p-3 cursor-pointer text-sm ${trigger === "SCHEDULED" ? "border-accent ring-1 ring-accent" : ""}`}>
                <input type="radio" className="hidden" checked={trigger === "SCHEDULED"} onChange={() => setTrigger("SCHEDULED")} />
                <div className="font-medium">Scheduled blast</div>
                <div className="text-xs text-ink-faint mt-0.5">Send to the audience now, later, or on a recurring schedule</div>
              </label>
              <label className={`flex-1 card p-3 cursor-pointer text-sm ${trigger === "EVENT" ? "border-accent ring-1 ring-accent" : ""}`}>
                <input type="radio" className="hidden" checked={trigger === "EVENT"} onChange={() => setTrigger("EVENT")} />
                <div className="font-medium">Event-triggered</div>
                <div className="text-xs text-ink-faint mt-0.5">Fires per contact when they perform an event (via /api/track)</div>
              </label>
            </div>
            {trigger === "EVENT" && (
              <div className="max-w-sm mt-3">
                <Field label="Trigger event name" hint='e.g. "signup" — each matching contact gets the message once'>
                  <input className={inputCls + " figure"} value={triggerEvent} onChange={(e) => setTriggerEvent(e.target.value)} placeholder="signup" />
                </Field>
              </div>
            )}
          </div>
          <div className="grid grid-cols-4 gap-3">
            {(channels ?? []).map((c) => (
              <button
                key={c.channel}
                disabled={!c.configured}
                onClick={() => setChannel(c.channel)}
                title={c.configured ? "" : c.hint}
                className={`card p-4 text-left transition-all ${
                  channel === c.channel ? "border-accent ring-1 ring-accent" : ""
                } ${!c.configured ? "opacity-40 cursor-not-allowed" : "hover:-translate-y-0.5"}`}
              >
                <div className="font-medium text-sm">{c.label}</div>
                <div className={`figure text-[10px] uppercase tracking-wider mt-1 ${c.configured ? "text-good" : "text-ink-faint"}`}>
                  {c.configured ? "configured" : "not configured"}
                </div>
              </button>
            ))}
          </div>
          {isPushChannel && (
            <label className="flex items-start gap-2.5 text-sm card p-3">
              <input type="checkbox" className="mt-1" checked={allPushPlatforms} onChange={(e) => setAllPushPlatforms(e.target.checked)} />
              <span>
                All phones — send to every iOS, Android and web device
                <span className="block text-xs text-ink-faint">One {channel} template, delivered through each device&apos;s own provider (APNs, FCM, web push).</span>
              </span>
            </label>
          )}
          <Button onClick={() => setStep(1)} disabled={!name || !channel || (trigger === "EVENT" && !triggerEvent)}>Continue</Button>
        </div>
      )}

      {step === 1 && (
        <div className="rise space-y-5">
          {channelTemplates.length === 0 ? (
            <div className="card p-6 text-sm text-ink-soft">
              No {channel} templates yet — <Link className="text-accent underline" href="/templates/new">create one</Link> first.
            </div>
          ) : (
            <>
              <div className="figure text-[11px] uppercase tracking-[0.18em] text-ink-soft">
                Variants {variants.length > 1 && <span className="text-accent">(A/B test — weights must sum to 100)</span>}
              </div>
              {variants.map((v, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="figure w-6 text-accent">{v.name}</span>
                  <select
                    className={inputCls + " max-w-xs"}
                    value={v.templateId}
                    onChange={(e) => setVariants((vs) => vs.map((x, j) => (j === i ? { ...x, templateId: e.target.value } : x)))}
                  >
                    {channelTemplates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    className={inputCls + " w-24"}
                    value={v.weight}
                    onChange={(e) => setVariants((vs) => vs.map((x, j) => (j === i ? { ...x, weight: Number(e.target.value) } : x)))}
                  />
                  <span className="text-xs text-ink-faint">%</span>
                  {variants.length > 1 && (
                    <button className="text-ink-faint hover:text-accent" onClick={() => setVariants((vs) => vs.filter((_, j) => j !== i))}>×</button>
                  )}
                </div>
              ))}
              <div className="flex gap-3">
                <Button
                  variant="ghost"
                  small
                  onClick={() =>
                    setVariants((vs) => {
                      const next = [...vs, { templateId: channelTemplates[0].id, name: String.fromCharCode(65 + vs.length), weight: 0 }];
                      const even = Math.floor(100 / next.length);
                      return next.map((v, i) => ({ ...v, weight: i === 0 ? 100 - even * (next.length - 1) : even }));
                    })
                  }
                >
                  {variants.length === 0 ? "+ Choose template" : "+ Add variant"}
                </Button>
              </div>
              {variants.length > 0 && totalWeight !== 100 && (
                <div className="text-accent text-sm">Weights sum to {totalWeight} — must be 100.</div>
              )}

              {variants.length > 0 && (
                <div>
                  <div className="figure text-[11px] uppercase tracking-[0.18em] text-ink-soft mb-3 mt-2">
                    Content preview
                  </div>
                  <div className={`grid gap-4 ${variants.length > 1 ? "grid-cols-2" : "grid-cols-1 max-w-2xl"}`}>
                    {variants.map((v, i) => {
                      const tpl = channelTemplates.find((t) => t.id === v.templateId);
                      if (!tpl) return null;
                      return (
                        <div key={i}>
                          <div className="flex items-center gap-2 mb-2">
                            <span className="figure text-xs text-accent">{v.name}</span>
                            <span className="text-xs text-ink-soft">{tpl.name}</span>
                            <span className="figure text-[10px] text-ink-faint">· {v.weight}%</span>
                          </div>
                          <TemplatePreview template={tpl} height={variants.length > 1 ? 320 : 420} />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <Button onClick={() => setStep(2)} disabled={!variants.length || totalWeight !== 100}>Continue</Button>
            </>
          )}
        </div>
      )}

      {step === 2 && (
        <div className="rise space-y-5 max-w-md">
          <Field label="Segment">
            <select className={inputCls} value={segmentId} onChange={(e) => setSegmentId(e.target.value)}>
              <option value="">Everyone</option>
              {(segments ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Newsletter or topic" hint="Newsletters reach subscribers only; topics skip people who opted out">
            <select className={inputCls} value={subscriptionGroupId} onChange={(e) => setSubscriptionGroupId(e.target.value)}>
              <option value="">None — not tied to a newsletter</option>
              {(subGroups ?? []).filter((g) => g.kind === "newsletter").length > 0 && (
                <optgroup label="Newsletters">
                  {(subGroups ?? []).filter((g) => g.kind === "newsletter").map((g) => (
                    <option key={g.id} value={g.id}>{g.name} ({g.subscribers} subscribed)</option>
                  ))}
                </optgroup>
              )}
              {(subGroups ?? []).filter((g) => g.kind === "topic").length > 0 && (
                <optgroup label="Topics">
                  {(subGroups ?? []).filter((g) => g.kind === "topic").map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </optgroup>
              )}
            </select>
          </Field>
          {audience && (
            <div className="figure text-sm text-ink-soft space-y-1">
              <div>
                <span className="text-accent text-2xl">{audience.reachable.toLocaleString()}</span> reachable on {isPushChannel && allPushPlatforms ? "all push platforms" : channel}
                <span className="text-ink-faint"> of {audience.matching.toLocaleString()} matching contacts</span>
              </div>
              {audience.devices.length > 0 && (
                <div className="text-xs text-ink-faint">
                  {audience.devices.reduce((n, d) => n + d.count, 0) === 1 ? "1 device" : `${audience.devices.reduce((n, d) => n + d.count, 0)} devices`}:{" "}
                  {audience.devices.map((d) => `${d.count} ${d.platform}`).join(" · ")}
                </div>
              )}
              <div className="text-xs text-ink-faint">Suppressions, quiet hours and frequency caps apply at send time.</div>
            </div>
          )}
          <Button onClick={() => setStep(3)}>Continue</Button>
        </div>
      )}

      {step === 3 && (
        <div className="rise space-y-5 max-w-md">
          <div className="card p-5 text-sm space-y-1.5">
            <div><span className="text-ink-faint">Campaign:</span> <span className="font-medium">{name}</span></div>
            <div><span className="text-ink-faint">Channel:</span> {channel}{isPushChannel && allPushPlatforms && " + every other push platform"}</div>
            <div><span className="text-ink-faint">Delivery:</span> {trigger === "EVENT" ? `on event "${triggerEvent}"` : "scheduled blast"}</div>
            <div><span className="text-ink-faint">Variants:</span> {variants.map((v) => `${v.name} (${v.weight}%)`).join(", ")}</div>
            <div><span className="text-ink-faint">Audience:</span> {segmentId ? (segments ?? []).find((s) => s.id === segmentId)?.name : "Everyone"}
              {subscriptionGroupId && <> · {(subGroups ?? []).find((g) => g.id === subscriptionGroupId)?.name}</>}
              {audience && <span className="text-ink-faint"> ({audience.reachable.toLocaleString()} reachable)</span>}
            </div>
          </div>

          {trigger === "SCHEDULED" && (
            <>
              <div className="flex gap-3">
                <label className={`flex-1 card p-3 cursor-pointer text-sm text-center ${when === "now" ? "border-accent ring-1 ring-accent" : ""}`}>
                  <input type="radio" className="hidden" checked={when === "now"} onChange={() => setWhen("now")} />
                  Send now
                </label>
                <label className={`flex-1 card p-3 cursor-pointer text-sm text-center ${when === "later" ? "border-accent ring-1 ring-accent" : ""}`}>
                  <input type="radio" className="hidden" checked={when === "later"} onChange={() => setWhen("later")} />
                  Schedule
                </label>
              </div>
              {when === "later" && (
                <input type="datetime-local" className={inputCls} value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
              )}
              <Field label="Repeat">
                <select className={inputCls} value={recurrence} onChange={(e) => setRecurrence(e.target.value as typeof recurrence)}>
                  <option value="NONE">One-time</option>
                  <option value="DAILY">Daily (new matching contacts each run)</option>
                  <option value="WEEKLY">Weekly</option>
                </select>
              </Field>
              <label className={`flex items-start gap-2.5 text-sm ${bypassDeliveryRules ? "opacity-50" : ""}`}>
                <input type="checkbox" className="mt-1" disabled={bypassDeliveryRules} checked={sendTimeOptimization && !bypassDeliveryRules} onChange={(e) => setSendTimeOptimization(e.target.checked)} />
                <span>
                  Deliver at each reader&apos;s best time
                  <span className="block text-xs text-ink-faint">
                    Every reader gets it at the hour they usually open messages or use the app, within 24 hours of the start.
                    {bypassDeliveryRules && " Not for breaking news, which goes out immediately."}
                  </span>
                </span>
              </label>
            </>
          )}

          <details className="card p-4">
            <summary className="figure text-[11px] uppercase tracking-[0.15em] text-ink-soft cursor-pointer">
              Advanced — conversions, control group, breaking news, tags
            </summary>
            <div className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Conversion event" hint="Tracked event that counts as success">
                  <input className={inputCls + " figure"} value={conversionEvent} onChange={(e) => setConversionEvent(e.target.value)} placeholder="purchase" />
                </Field>
                <Field label="Control group %" hint="Held out to measure lift (0–50)">
                  <input type="number" min={0} max={50} className={inputCls + " figure"} value={controlGroupPct} onChange={(e) => setControlGroupPct(Number(e.target.value))} />
                </Field>
              </div>
              <label className="flex items-start gap-2.5 text-sm">
                <input type="checkbox" className="mt-1" checked={bypassDeliveryRules} onChange={(e) => setBypassDeliveryRules(e.target.checked)} />
                <span>
                  Breaking news — ignore quiet hours and frequency caps
                  <span className="block text-xs text-ink-faint">Subscription-group opt-outs and unsubscribes still apply.</span>
                </span>
              </label>
              <Field label="Tags" hint="Comma-separated">
                <input className={inputCls} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="onboarding, q3" />
              </Field>
            </div>
          </details>

          {error && <div className="text-accent text-sm">{error}</div>}
          <Button onClick={launch} disabled={busy || (trigger === "SCHEDULED" && when === "later" && !scheduledAt)}>
            {busy
              ? "Launching…"
              : trigger === "EVENT"
                ? "⚡ Activate trigger"
                : when === "now"
                  ? "🚀 Launch now"
                  : "Schedule campaign"}
          </Button>
        </div>
      )}
    </div>
  );
}

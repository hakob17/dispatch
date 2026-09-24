"use client";

import { createContext, useContext, useState } from "react";
import { inputCls } from "@/components/ui";
import {
  NODE_META,
  blankNode,
  describeDelay,
  findNode,
  messageNodes,
  outletsOf,
  updateNode,
  type NodeType,
  type Rule,
  type TreeNode,
} from "./model";

export interface Catalogs {
  templates: { id: string; name: string; channel: string }[];
  segments: { id: string; name: string }[];
  groups: { id: string; name: string; kind: "newsletter" | "topic" }[];
}

/** Per-node counts for a running journey: how many readers passed, and per branch. */
export type VisitStats = Map<string, { total: number; branches: Record<string, number> }>;

const PUSH = ["FCM", "APNS", "WEB_PUSH"];
const TYPE_ORDER: NodeType[] = ["MESSAGE", "DELAY", "CONDITION", "RANDOM", "WAIT_EVENT", "EXIT"];

interface FlowContext {
  root: TreeNode | null;
  editable: boolean;
  catalogs: Catalogs;
  stats?: VisitStats;
  allMessages: TreeNode[];
  edit: (key: string, fn: (n: TreeNode) => TreeNode | null) => void;
  insert: (parentKey: string | null, outlet: string, type: NodeType) => void;
  remove: (n: TreeNode) => void;
}
const FlowCtx = createContext<FlowContext | null>(null);

/**
 * Canvas-style journey flow. Editable when `onChange` is given; otherwise read-only with
 * visit counts on every node and branch.
 */
export default function JourneyFlow({
  root,
  onChange,
  catalogs,
  stats,
}: {
  root: TreeNode | null;
  onChange?: (root: TreeNode | null) => void;
  catalogs: Catalogs;
  stats?: VisitStats;
}) {
  const editable = !!onChange;
  const allMessages = messageNodes(root);

  const edit = (key: string, fn: (n: TreeNode) => TreeNode | null) => root && onChange?.(updateNode(root, key, fn));

  const newNode = (type: NodeType) => {
    const first = catalogs.templates[0];
    return blankNode(type, type === "MESSAGE" && first ? { channel: first.channel, templateId: first.id } : {});
  };
  /** Insert a new node at an outlet; whatever was there moves under the new node's first outlet. */
  const insert = (parentKey: string | null, outlet: string, type: NodeType) => {
    const node = newNode(type);
    if (parentKey === null) {
      const firstOutlet = outletsOf(node)[0]?.name;
      if (firstOutlet && root) node.children[firstOutlet] = root;
      return onChange?.(node);
    }
    edit(parentKey, (p) => {
      const existing = p.children[outlet];
      const firstOutlet = outletsOf(node)[0]?.name;
      if (firstOutlet && existing) node.children[firstOutlet] = existing;
      return { ...p, children: { ...p.children, [outlet]: node } };
    });
  };
  /** Remove a node: single-path nodes splice out; splits take their subtrees with them. */
  const remove = (n: TreeNode) => {
    const outs = outletsOf(n);
    if (outs.length > 1 && Object.values(n.children).some(Boolean) && !confirm(`Remove this ${NODE_META[n.type].title.toLowerCase()} and every step under it?`)) return;
    const replacement = outs.length === 1 ? n.children[outs[0].name] : null;
    if (root && root.key === n.key) return onChange?.(replacement);
    edit(n.key, () => replacement);
  };

  if (!root) {
    return editable ? (
      <div className="flex flex-col items-center gap-2 py-8">
        <p className="text-sm text-ink-soft">Start with a first step.</p>
        <AddStep onPick={(t) => insert(null, "default", t)} />
      </div>
    ) : (
      <p className="text-sm text-ink-faint">No steps.</p>
    );
  }
  return (
    <FlowCtx.Provider value={{ root, editable, catalogs, stats, allMessages, edit, insert, remove }}>
      <div className="overflow-x-auto pb-6" aria-label="Journey flow">
        <div className="inline-flex flex-col items-center min-w-full">
          <span className="figure text-[10px] uppercase tracking-[0.2em] text-ink-faint mb-1">entry</span>
          <div className="w-px h-4 bg-line-strong" />
          <FlowNode n={root} />
        </div>
      </div>
    </FlowCtx.Provider>
  );
}

function FlowNode({ n }: { n: TreeNode }) {
  const { editable, stats, catalogs, allMessages, edit, remove } = useContext(FlowCtx)!;
  const outs = outletsOf(n);
  const visits = stats?.get(n.key);
  return (
    <div className="flex flex-col items-center">
      <div className="card w-72 p-3 text-sm relative">
        <div className="flex items-center justify-between gap-2 mb-2">
          <span className="figure text-[10px] uppercase tracking-[0.15em] text-ink-soft">{NODE_META[n.type].title}</span>
          {editable ? (
            <button className="text-ink-faint hover:text-accent text-xs" onClick={() => remove(n)} aria-label={`Remove ${NODE_META[n.type].title}`}>
              remove
            </button>
          ) : (
            visits && <span className="figure text-xs text-ink-soft">{visits.total.toLocaleString()} passed</span>
          )}
        </div>
        <NodeBody n={n} editable={editable} catalogs={catalogs} messages={allMessages} onChange={(next) => edit(n.key, () => next)} />
      </div>
      {outs.length === 1 && <Continue parent={n} outlet={outs[0].name} />}
      {outs.length > 1 && (
        <>
          <div className="w-px h-4 bg-line-strong" />
          <div className="flex gap-6 items-start border-t border-line-strong pt-0">
            {outs.map((o) => (
              <div key={o.name} className="flex flex-col items-center">
                <div className="w-px h-3 bg-line-strong" />
                <span className="figure text-[10px] uppercase tracking-wider bg-paper-sunken border border-line px-2 py-0.5">
                  {o.label}
                  {visits && <> · {(visits.branches[branchStatKey(n, o.name)] ?? 0).toLocaleString()}</>}
                </span>
                <Continue parent={n} outlet={o.name} />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Continue({ parent, outlet }: { parent: TreeNode; outlet: string }) {
  const { editable, insert, root, catalogs } = useContext(FlowCtx)!;
  const child = parent.children[outlet];
  const ref = !child ? parent.refs?.[outlet] : undefined;
  if (ref) {
    const target = findNode(root, ref);
    const name = target?.type === "MESSAGE" ? catalogs.templates.find((t) => t.id === target.templateId)?.name : target ? NODE_META[target.type].title : ref;
    return (
      <>
        <div className="w-px h-4 bg-line-strong" />
        <span className="figure text-[10px] text-ink-soft border border-dashed border-line-strong px-2 py-1 max-w-[10rem] text-center">→ continues at “{name}”</span>
      </>
    );
  }
  return (
    <>
      <div className="w-px h-4 bg-line-strong" />
      {editable && <AddStep onPick={(t) => insert(parent.key, outlet, t)} compact={!!child} />}
      {child ? (
        <>
          {editable && <div className="w-px h-4 bg-line-strong" />}
          <FlowNode n={child} />
        </>
      ) : (
        !editable && <span className="figure text-[10px] text-ink-faint">end</span>
      )}
    </>
  );
}

/** JourneyVisit.branch values: yes/no, "0"/"1" for A/B, event/timeout. */
function branchStatKey(n: TreeNode, outlet: string): string {
  return n.type === "RANDOM" ? outlet.slice(1) : outlet;
}

function AddStep({ onPick, compact }: { onPick: (t: NodeType) => void; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="Add a step here"
        className={`border border-dashed border-line-strong text-ink-soft hover:border-accent hover:text-accent bg-paper-raised ${compact ? "w-6 h-6 text-sm leading-none rounded-full" : "px-3 py-1.5 text-xs"}`}
      >
        {compact ? "+" : "+ Add step"}
      </button>
      {open && (
        <div className="absolute z-20 left-1/2 -translate-x-1/2 mt-1 w-64 card p-1 shadow-lg" role="menu">
          {TYPE_ORDER.map((t) => (
            <button
              key={t}
              role="menuitem"
              className="w-full text-left px-3 py-2 hover:bg-paper-sunken"
              onClick={() => {
                setOpen(false);
                onPick(t);
              }}
            >
              <div className="text-sm font-medium">{NODE_META[t].title}</div>
              <div className="text-xs text-ink-faint">{NODE_META[t].hint}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// --------------------------------------------------------------- node bodies

function NodeBody({
  n,
  editable,
  catalogs,
  messages,
  onChange,
}: {
  n: TreeNode;
  editable: boolean;
  catalogs: Catalogs;
  messages: TreeNode[];
  onChange: (n: TreeNode) => void;
}) {
  const cfg = (patch: Record<string, unknown>) => onChange({ ...n, config: { ...n.config, ...patch } });
  const templateName = (id?: string) => catalogs.templates.find((t) => t.id === id)?.name ?? "—";
  const small = inputCls + " py-1 text-xs";

  switch (n.type) {
    case "MESSAGE": {
      const channels = [...new Set(catalogs.templates.map((t) => t.channel))];
      if (!editable)
        return (
          <div>
            <div className="font-medium">{templateName(n.templateId)}</div>
            <div className="figure text-[10px] text-ink-faint">{n.config.allPushPlatforms ? "all phones" : n.channel}</div>
          </div>
        );
      return (
        <div className="space-y-2">
          <select className={small} aria-label="Channel" value={n.channel ?? ""} onChange={(e) => {
            const t = catalogs.templates.find((x) => x.channel === e.target.value);
            onChange({ ...n, channel: e.target.value, templateId: t?.id });
          }}>
            {channels.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select className={small} aria-label="Template" value={n.templateId ?? ""} onChange={(e) => onChange({ ...n, templateId: e.target.value })}>
            {catalogs.templates.filter((t) => t.channel === n.channel).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          {PUSH.includes(n.channel ?? "") && (
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={!!n.config.allPushPlatforms} onChange={(e) => cfg({ allPushPlatforms: e.target.checked })} />
              All phones (iOS, Android, web)
            </label>
          )}
        </div>
      );
    }
    case "DELAY":
      return editable ? <Duration minutes={Number(n.config.minutes ?? 60)} onChange={(m) => cfg({ minutes: m })} label="Wait" /> : <div>Wait {describeDelay(Number(n.config.minutes ?? 0))}</div>;
    case "WAIT_EVENT":
      return editable ? (
        <div className="space-y-2">
          <input className={small + " figure"} aria-label="Event name" placeholder="event name, e.g. article_read" value={String(n.config.event ?? "")} onChange={(e) => cfg({ event: e.target.value })} />
          <Duration minutes={Number(n.config.timeoutMinutes ?? 60)} onChange={(m) => cfg({ timeoutMinutes: m })} label="Give up after" />
        </div>
      ) : (
        <div>
          Until <span className="figure">{String(n.config.event)}</span>, at most {describeDelay(Number(n.config.timeoutMinutes ?? 0))}
        </div>
      );
    case "RANDOM": {
      const weights = (n.config.weights as number[]) ?? [50, 50];
      const sum = weights.reduce((a, b) => a + b, 0);
      if (!editable) return <div>{weights.map((w, i) => `${String.fromCharCode(65 + i)} ${w}%`).join(" · ")}</div>;
      const setWeights = (ws: number[]) => {
        const children: Record<string, TreeNode | null> = {};
        ws.forEach((_, i) => (children[`b${i}`] = n.children[`b${i}`] ?? null));
        onChange({ ...n, config: { ...n.config, weights: ws }, children });
      };
      return (
        <div className="space-y-2">
          <div className="flex gap-1.5 flex-wrap">
            {weights.map((w, i) => (
              <label key={i} className="flex items-center gap-1 text-xs">
                {String.fromCharCode(65 + i)}
                <input type="number" min={0} max={100} className={small + " w-14 figure"} aria-label={`Path ${String.fromCharCode(65 + i)} percent`} value={w}
                  onChange={(e) => setWeights(weights.map((x, j) => (j === i ? Number(e.target.value) : x)))} />
              </label>
            ))}
          </div>
          <div className="flex gap-2 text-xs">
            {weights.length < 5 && <button className="text-accent" onClick={() => setWeights([...weights, 0])}>+ path</button>}
            {weights.length > 2 && <button className="text-ink-soft" onClick={() => setWeights(weights.slice(0, -1))}>− path</button>}
            <span className={sum === 100 ? "text-ink-faint" : "text-accent"}>{sum}%</span>
          </div>
        </div>
      );
    }
    case "CONDITION": {
      const rules = (n.config.rules as Rule[]) ?? [];
      const match = (n.config.match as string) ?? "all";
      if (!editable) return <div className="text-xs">{rules.map((r) => describeRule(r, catalogs, messages)).join(match === "any" ? " or " : " and ")}</div>;
      const setRules = (rs: Rule[]) => cfg({ rules: rs });
      return (
        <div className="space-y-2">
          <select className={small} aria-label="Match" value={match} onChange={(e) => cfg({ match: e.target.value })}>
            <option value="all">Yes when all of these are true</option>
            <option value="any">Yes when any of these is true</option>
          </select>
          {rules.map((r, i) => (
            <RuleEditor key={i} rule={r} catalogs={catalogs} messages={messages} onChange={(nr) => setRules(rules.map((x, j) => (j === i ? nr : x)))} onRemove={rules.length > 1 ? () => setRules(rules.filter((_, j) => j !== i)) : undefined} />
          ))}
          <button className="text-accent text-xs" onClick={() => setRules([...rules, { type: "event", name: "" }])}>+ rule</button>
        </div>
      );
    }
    case "EXIT":
      return <div className="text-ink-soft">Reader leaves the journey</div>;
  }
}

function Duration({ minutes, onChange, label }: { minutes: number; onChange: (m: number) => void; label: string }) {
  const unit = minutes % 1440 === 0 ? 1440 : minutes % 60 === 0 ? 60 : 1;
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className="text-ink-soft">{label}</span>
      <input type="number" min={1} className={inputCls + " py-1 text-xs w-16 figure"} aria-label={`${label} amount`} value={minutes / unit} onChange={(e) => onChange(Math.max(1, Number(e.target.value)) * unit)} />
      <select className={inputCls + " py-1 text-xs w-auto"} aria-label={`${label} unit`} value={unit} onChange={(e) => onChange((minutes / unit) * Number(e.target.value))}>
        <option value={1}>minutes</option>
        <option value={60}>hours</option>
        <option value={1440}>days</option>
      </select>
    </div>
  );
}

const RULE_TYPES: { type: Rule["type"]; label: string }[] = [
  { type: "event", label: "Did an event" },
  { type: "engaged", label: "Opened / clicked a step's message" },
  { type: "attribute", label: "Profile attribute" },
  { type: "segment", label: "Is in segment" },
  { type: "subscribed", label: "Subscribed to" },
  { type: "reachable", label: "Can be reached by" },
];

function RuleEditor({ rule, catalogs, messages, onChange, onRemove }: { rule: Rule; catalogs: Catalogs; messages: TreeNode[]; onChange: (r: Rule) => void; onRemove?: () => void }) {
  const small = inputCls + " py-1 text-xs";
  const blank = (type: Rule["type"]): Rule =>
    type === "event" ? { type, name: "" }
    : type === "engaged" ? { type, nodeKey: messages[0]?.key ?? "", action: "opened" }
    : type === "attribute" ? { type, field: "attributes.", op: "eq", value: "" }
    : type === "segment" ? { type, segmentId: catalogs.segments[0]?.id ?? "" }
    : type === "subscribed" ? { type, groupId: catalogs.groups[0]?.id ?? "" }
    : { type: "reachable", channel: "ANY_PUSH" };
  return (
    <div className="border border-line p-2 space-y-1.5">
      <div className="flex gap-1.5">
        <select className={small} aria-label="Rule type" value={rule.type} onChange={(e) => onChange(blank(e.target.value as Rule["type"]))}>
          {RULE_TYPES.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
        </select>
        {onRemove && <button className="text-ink-faint hover:text-accent text-xs px-1" onClick={onRemove} aria-label="Remove rule">×</button>}
      </div>
      {rule.type === "event" && (
        <div className="flex gap-1.5">
          <input className={small + " figure"} aria-label="Event name" placeholder="event name" value={rule.name} onChange={(e) => onChange({ ...rule, name: e.target.value })} />
          <input type="number" min={1} className={small + " w-20 figure"} aria-label="Within hours" placeholder="since entry" value={rule.withinHours ?? ""} onChange={(e) => onChange({ ...rule, withinHours: e.target.value ? Number(e.target.value) : undefined })} />
        </div>
      )}
      {rule.type === "engaged" && (
        <div className="flex gap-1.5">
          <select className={small} aria-label="Action" value={rule.action} onChange={(e) => onChange({ ...rule, action: e.target.value as "opened" | "clicked" })}>
            <option value="opened">opened</option>
            <option value="clicked">clicked</option>
          </select>
          <select className={small} aria-label="Message step" value={rule.nodeKey} onChange={(e) => onChange({ ...rule, nodeKey: e.target.value })}>
            {messages.map((m) => <option key={m.key} value={m.key}>{catalogs.templates.find((t) => t.id === m.templateId)?.name ?? m.key}</option>)}
          </select>
        </div>
      )}
      {rule.type === "attribute" && (
        <div className="grid grid-cols-3 gap-1.5">
          <input className={small + " figure"} aria-label="Field" value={rule.field} onChange={(e) => onChange({ ...rule, field: e.target.value })} placeholder="attributes.tier" />
          <select className={small} aria-label="Operator" value={rule.op} onChange={(e) => onChange({ ...rule, op: e.target.value as typeof rule.op })}>
            {["eq", "neq", "contains", "exists", "gt", "lt"].map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          {rule.op !== "exists" && <input className={small} aria-label="Value" value={rule.value ?? ""} onChange={(e) => onChange({ ...rule, value: e.target.value })} />}
        </div>
      )}
      {rule.type === "segment" && (
        <select className={small} aria-label="Segment" value={rule.segmentId} onChange={(e) => onChange({ ...rule, segmentId: e.target.value })}>
          {catalogs.segments.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      )}
      {rule.type === "subscribed" && (
        <select className={small} aria-label="Newsletter or topic" value={rule.groupId} onChange={(e) => onChange({ ...rule, groupId: e.target.value })}>
          {catalogs.groups.map((g) => <option key={g.id} value={g.id}>{g.name} ({g.kind})</option>)}
        </select>
      )}
      {rule.type === "reachable" && (
        <select className={small} aria-label="Channel" value={rule.channel} onChange={(e) => onChange({ ...rule, channel: e.target.value as typeof rule.channel })}>
          <option value="ANY_PUSH">any push device</option>
          <option value="APNS">iOS push</option>
          <option value="FCM">Android push (FCM)</option>
          <option value="WEB_PUSH">web push</option>
          <option value="EMAIL">email</option>
        </select>
      )}
    </div>
  );
}

function describeRule(r: Rule, c: Catalogs, messages: TreeNode[]): string {
  switch (r.type) {
    case "event": return `did "${r.name}"${r.withinHours ? ` in ${r.withinHours}h` : ""}`;
    case "engaged": {
      const m = messages.find((x) => x.key === r.nodeKey);
      return `${r.action} "${c.templates.find((t) => t.id === m?.templateId)?.name ?? r.nodeKey}"`;
    }
    case "attribute": return `${r.field} ${r.op} ${r.value ?? ""}`.trim();
    case "segment": return `in ${c.segments.find((s) => s.id === r.segmentId)?.name ?? "segment"}`;
    case "subscribed": return `subscribed to ${c.groups.find((g) => g.id === r.groupId)?.name ?? "group"}`;
    case "reachable": return `reachable by ${r.channel === "ANY_PUSH" ? "push" : r.channel.toLowerCase()}`;
  }
}

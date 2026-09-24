/**
 * Client-side journey model. The builder edits a tree (each outlet holds at most one child);
 * saving flattens it to the node graph the API stores (see src/lib/journeys.ts).
 */
export type NodeType = "MESSAGE" | "DELAY" | "CONDITION" | "RANDOM" | "WAIT_EVENT" | "EXIT";

export type Rule =
  | { type: "attribute"; field: string; op: "eq" | "neq" | "contains" | "exists" | "gt" | "lt"; value?: string }
  | { type: "segment"; segmentId: string }
  | { type: "event"; name: string; withinHours?: number }
  | { type: "engaged"; nodeKey: string; action: "opened" | "clicked" }
  | { type: "subscribed"; groupId: string }
  | { type: "reachable"; channel: "EMAIL" | "FCM" | "APNS" | "WEB_PUSH" | "ANY_PUSH" };

export interface TreeNode {
  key: string;
  type: NodeType;
  label?: string;
  channel?: string;
  templateId?: string;
  config: Record<string, unknown>;
  /** outlet name → child (null = the path ends here) */
  children: Record<string, TreeNode | null>;
  /** outlet name → key of a node drawn elsewhere (paths that merge); used when the child is null */
  refs?: Record<string, string>;
}

export const NODE_META: Record<NodeType, { title: string; hint: string }> = {
  MESSAGE: { title: "Send message", hint: "Push, email, in-app, card…" },
  DELAY: { title: "Delay", hint: "Wait before the next step" },
  CONDITION: { title: "Condition split", hint: "Yes / no on who the reader is or what they did" },
  RANDOM: { title: "A/B split", hint: "Random paths — each reader always gets the same one" },
  WAIT_EVENT: { title: "Wait for event", hint: "Continue when they act, or after a timeout" },
  EXIT: { title: "Exit", hint: "Leave the journey" },
};

/** Outlets and their labels for a node. */
export function outletsOf(n: Pick<TreeNode, "type" | "config">): { name: string; label: string }[] {
  switch (n.type) {
    case "CONDITION": return [{ name: "yes", label: "Yes" }, { name: "no", label: "No" }];
    case "RANDOM": return ((n.config.weights as number[]) ?? [50, 50]).map((w, i) => ({ name: `b${i}`, label: `${String.fromCharCode(65 + i)} · ${w}%` }));
    case "WAIT_EVENT": return [{ name: "event", label: "Did it" }, { name: "timeout", label: "Timed out" }];
    case "EXIT": return [];
    default: return [{ name: "default", label: "" }];
  }
}

let seq = 0;
export function newKey(type: NodeType): string {
  seq += 1;
  return `${type.toLowerCase().replace("_", "")}${Date.now().toString(36).slice(-4)}${seq}`;
}

export function blankNode(type: NodeType, defaults: { channel?: string; templateId?: string } = {}): TreeNode {
  const config: Record<string, unknown> =
    type === "DELAY" ? { minutes: 60 * 24 }
    : type === "CONDITION" ? { match: "all", rules: [{ type: "reachable", channel: "ANY_PUSH" }] }
    : type === "RANDOM" ? { weights: [50, 50] }
    : type === "WAIT_EVENT" ? { event: "", timeoutMinutes: 60 * 24 * 3 }
    : {};
  const node: TreeNode = { key: newKey(type), type, config, children: {} };
  if (type === "MESSAGE") Object.assign(node, defaults);
  for (const o of outletsOf(node)) node.children[o.name] = null;
  return node;
}

// ---------------------------------------------------------------- flatten

interface ApiNode {
  key: string;
  type: NodeType;
  label?: string;
  channel?: string;
  templateId?: string;
  config?: Record<string, unknown>;
  next: Record<string, unknown>;
}

/** Tree → API nodes (depth-first, entry first). */
export function flatten(root: TreeNode): ApiNode[] {
  const out: ApiNode[] = [];
  const walk = (n: TreeNode) => {
    const child = (name: string) => n.children[name]?.key ?? n.refs?.[name] ?? null;
    const next: Record<string, unknown> =
      n.type === "CONDITION" ? { yes: child("yes"), no: child("no") }
      : n.type === "RANDOM" ? { branches: outletsOf(n).map((o) => child(o.name)) }
      : n.type === "WAIT_EVENT" ? { event: child("event"), timeout: child("timeout") }
      : n.type === "EXIT" ? {}
      : { default: child("default") };
    out.push({
      key: n.key,
      type: n.type,
      ...(n.label ? { label: n.label } : {}),
      ...(n.type === "MESSAGE" ? { channel: n.channel, templateId: n.templateId } : {}),
      ...(n.type !== "EXIT" && Object.keys(n.config).length ? { config: n.config } : {}),
      next,
    });
    for (const o of outletsOf(n)) if (n.children[o.name]) walk(n.children[o.name]!);
  };
  walk(root);
  return out;
}

// ------------------------------------------------------------------ load

export interface StoredStep {
  id: string;
  key: string | null;
  type: string;
  label: string | null;
  order: number;
  delayMinutes: number;
  channel: string | null;
  templateId: string | null;
  config: Record<string, unknown> | null;
  next: Record<string, unknown> | null;
  template?: { name: string } | null;
}

/**
 * Stored steps → tree. Branching journeys rebuild from `next`; linear ones become a chain of
 * (Delay →) Message nodes keyed by step id. A node reached a second time (paths that merge,
 * or a loop) is drawn once; the other outlet keeps a `refs` pointer so it's shown and saved.
 */
export function toTree(steps: StoredStep[], entryKey: string | null): TreeNode | null {
  if (!steps.length) return null;
  if (!entryKey) {
    let root: TreeNode | null = null;
    let tail: TreeNode | null = null;
    const append = (n: TreeNode) => {
      if (!root) root = n;
      else tail!.children.default = n;
      tail = n;
    };
    for (const s of [...steps].sort((a, b) => a.order - b.order)) {
      if (s.delayMinutes > 0) append({ key: `delay-${s.id}`, type: "DELAY", config: { minutes: s.delayMinutes }, children: { default: null } });
      append({ key: s.id, type: "MESSAGE", channel: s.channel ?? undefined, templateId: s.templateId ?? undefined, config: {}, children: { default: null } });
    }
    return root;
  }
  const byKey = new Map(steps.filter((s) => s.key).map((s) => [s.key!, s]));
  const seen = new Set<string>();
  const build = (key: string | null | undefined): TreeNode | null => {
    if (!key || seen.has(key)) return null;
    const s = byKey.get(key);
    if (!s) return null;
    seen.add(key);
    const node: TreeNode = {
      key,
      type: s.type as NodeType,
      label: s.label ?? undefined,
      channel: s.channel ?? undefined,
      templateId: s.templateId ?? undefined,
      config: s.config ?? {},
      children: {},
    };
    const next = s.next ?? {};
    for (const o of outletsOf(node)) {
      const target =
        node.type === "RANDOM" ? (next.branches as (string | null)[] | undefined)?.[Number(o.name.slice(1))]
        : (next[o.name] as string | null | undefined);
      if (target && seen.has(target)) node.refs = { ...node.refs, [o.name]: target }; // merges into a path drawn elsewhere
      else node.children[o.name] = build(target);
    }
    return node;
  };
  return build(entryKey);
}

/** Immutable update of the node with `key` anywhere in the tree. */
export function updateNode(root: TreeNode, key: string, fn: (n: TreeNode) => TreeNode | null): TreeNode | null {
  if (root.key === key) return fn(root);
  const children: Record<string, TreeNode | null> = {};
  let changed = false;
  for (const [name, child] of Object.entries(root.children)) {
    const next = child ? updateNode(child, key, fn) : null;
    if (next !== child) changed = true;
    children[name] = next;
  }
  return changed ? { ...root, children } : root;
}

/** Find a node anywhere in the tree. */
export function findNode(root: TreeNode | null, key: string): TreeNode | null {
  if (!root) return null;
  if (root.key === key) return root;
  for (const c of Object.values(root.children)) {
    const hit = findNode(c, key);
    if (hit) return hit;
  }
  return null;
}

/** Every MESSAGE node (for "opened/clicked message X" conditions). */
export function messageNodes(root: TreeNode | null): TreeNode[] {
  if (!root) return [];
  return [...(root.type === "MESSAGE" ? [root] : []), ...Object.values(root.children).flatMap((c) => messageNodes(c))];
}

export function describeDelay(minutes: number): string {
  if (minutes % (60 * 24) === 0) return `${minutes / (60 * 24)} day${minutes === 60 * 24 ? "" : "s"}`;
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? "" : "s"}`;
  return `${minutes} min`;
}

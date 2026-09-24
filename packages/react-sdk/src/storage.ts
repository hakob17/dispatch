import type { KeyValueStorage } from "./types.js";

export function memoryStorage(): KeyValueStorage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

/** window.localStorage when available (browsers), otherwise in-memory. */
export function defaultStorage(): KeyValueStorage {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    if (ls) {
      const probe = "__dispatch_probe__";
      ls.setItem(probe, "1");
      ls.removeItem(probe);
      return ls;
    }
  } catch {
    // private mode / blocked storage
  }
  return memoryStorage();
}

export function randomId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  // RN without a crypto polyfill: good enough for an anonymous install id
  let s = "";
  for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-4${s.slice(13, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

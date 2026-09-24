"use client";

import { useCallback, useEffect, useState } from "react";

async function getJson(url: string): Promise<{ ok: true; json: unknown } | { ok: false; error: string }> {
  try {
    const res = await fetch(url);
    const json = await res.json();
    if (!res.ok) return { ok: false, error: json.error ? JSON.stringify(json.error) : `HTTP ${res.status}` };
    return { ok: true, json };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/** Tiny SWR-ish hook: fetch JSON, optional polling, manual refresh. */
export default function useFetch<T>(url: string | null, pollMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Loading = the latest response isn't for the current URL yet (derived, no effect-driven setState)
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const loading = !!url && loadedUrl !== url;

  const apply = useCallback((forUrl: string, r: Awaited<ReturnType<typeof getJson>>) => {
    if (r.ok) {
      setData(r.json as T);
      setError(null);
    } else setError(r.error);
    setLoadedUrl(forUrl);
  }, []);

  const refresh = useCallback(async () => {
    if (url) apply(url, await getJson(url));
  }, [url, apply]);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    const load = () => getJson(url).then((r) => !cancelled && apply(url, r));
    load();
    const t = pollMs ? setInterval(load, pollMs) : undefined;
    return () => {
      cancelled = true;
      if (t) clearInterval(t);
    };
  }, [url, pollMs, apply]);

  return { data, error, loading, refresh };
}

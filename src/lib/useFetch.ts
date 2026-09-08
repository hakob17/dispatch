"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Tiny SWR-ish hook: fetch JSON, optional polling, manual refresh. */
export default function useFetch<T>(url: string | null, pollMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const urlRef = useRef(url);
  urlRef.current = url;

  const refresh = useCallback(async () => {
    if (!urlRef.current) return;
    try {
      const res = await fetch(urlRef.current);
      const json = await res.json();
      if (!res.ok) setError(json.error ? JSON.stringify(json.error) : `HTTP ${res.status}`);
      else {
        setData(json);
        setError(null);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    refresh();
    if (pollMs) {
      const t = setInterval(refresh, pollMs);
      return () => clearInterval(t);
    }
  }, [url, pollMs, refresh]);

  return { data, error, loading, refresh };
}

import { useEffect, useRef, useState } from 'react';

export function useSSE<T>(url: string, opts?: { enabled?: boolean }): T | null {
  const [data, setData] = useState<T | null>(null);
  const evtRef = useRef<EventSource | null>(null);
  const enabled = opts?.enabled ?? true;
  useEffect(() => {
    if (!enabled) return;
    const es = new EventSource(url, { withCredentials: true });
    evtRef.current = es;
    es.onmessage = (ev) => {
      try { setData(JSON.parse(ev.data) as T); } catch { /* ignore */ }
    };
    es.onerror = () => {
      // Browser auto-reconnects. Keep stream.
    };
    return () => { es.close(); };
  }, [url, enabled]);
  return data;
}

export function useSSEFeed<T>(url: string, max = 200, opts?: { enabled?: boolean }): T[] {
  const [lines, setLines] = useState<T[]>([]);
  const enabled = opts?.enabled ?? true;
  useEffect(() => {
    if (!enabled) return;
    const es = new EventSource(url, { withCredentials: true });
    es.onmessage = (ev) => {
      try {
        const v = JSON.parse(ev.data) as T;
        setLines(prev => {
          const next = [v, ...prev];
          if (next.length > max) next.length = max;
          return next;
        });
      } catch { /* ignore */ }
    };
    return () => { es.close(); };
  }, [url, max, enabled]);
  return lines;
}

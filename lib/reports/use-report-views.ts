"use client";

import { useCallback, useEffect, useState } from "react";

export type ReportView = {
  id: string;
  name: string;
  categoryIds: string[];
};

const STORAGE_KEY = "crest.reportViews";

function load(): ReportView[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(views: ReportView[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(views));
  } catch {
    // Private browsing / quota errors — saved views are a convenience, not
    // critical state, so just drop the write.
  }
}

/**
 * Saved category-subset "views" (e.g. "Fixed Bills"), stored client-side only
 * — nothing round-trips through the server, so switching between the same 2-3
 * subsets works instantly and never touches the database.
 */
export function useReportViews() {
  const [views, setViews] = useState<ReportView[]>([]);

  // Loaded in an effect (not lazy useState init) so server and first client
  // render match — localStorage isn't available during SSR.
  useEffect(() => setViews(load()), []);

  const save = useCallback((name: string, categoryIds: string[]) => {
    setViews((prev) => {
      const next = [...prev, { id: crypto.randomUUID(), name, categoryIds }];
      write(next);
      return next;
    });
  }, []);

  const remove = useCallback((id: string) => {
    setViews((prev) => {
      const next = prev.filter((v) => v.id !== id);
      write(next);
      return next;
    });
  }, []);

  return { views, save, remove };
}

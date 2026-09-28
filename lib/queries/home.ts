"use client";

import type { QueryClient } from "@tanstack/react-query";
import { defineQuery } from "./define-query";
import type { HomeData } from "@/lib/budget";

async function fetchHomeView(): Promise<HomeData> {
  const res = await fetch("/api/home");
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "Failed to load home");
  }
  return res.json();
}

const homeViewQuery = defineQuery("home-view", fetchHomeView);

export function useHomeView() {
  return homeViewQuery.useResource([]);
}

export function prefetchHomeView(queryClient: QueryClient) {
  return homeViewQuery.prefetch(queryClient);
}

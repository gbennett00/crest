"use client";

import type { QueryClient } from "@tanstack/react-query";
import { defineQuery } from "./define-query";
import type { MembersResponse } from "@/app/api/members/route";

async function fetchMembers(): Promise<MembersResponse> {
  const res = await fetch("/api/members");
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? "Failed to load members");
  }
  return res.json();
}

const membersQuery = defineQuery("members", fetchMembers);

export function useMembers() {
  return membersQuery.useResource([]);
}

export function invalidateMembers(queryClient: QueryClient) {
  return membersQuery.invalidate(queryClient);
}

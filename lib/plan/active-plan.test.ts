import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getActivePlanId } from "./active-plan";

// Proxy mock: every chained call returns the proxy; maybeSingle() is terminal
// and resolves to the configured row/error (mirrors lib/ledger/operations.test.ts).
function makeMockClient(result: {
  data?: { plan_id: string } | null;
  error?: { message: string } | null;
}): SupabaseClient {
  const maybeSingleFn = vi
    .fn()
    .mockResolvedValue({ data: result.data ?? null, error: result.error ?? null });

  const proxy: Record<string, unknown> = new Proxy({} as Record<string, unknown>, {
    get(_, prop) {
      if (prop === "maybeSingle") return maybeSingleFn;
      return () => proxy;
    },
  });

  return { from: vi.fn(() => proxy) } as unknown as SupabaseClient;
}

describe("getActivePlanId", () => {
  it("returns the user's plan id", async () => {
    const client = makeMockClient({ data: { plan_id: "plan-1" } });
    await expect(getActivePlanId(client)).resolves.toBe("plan-1");
  });

  it("throws plan_missing when the user has no membership", async () => {
    const client = makeMockClient({ data: null });
    await expect(getActivePlanId(client)).rejects.toMatchObject({
      code: "plan_missing",
    });
  });

  it("throws db_error when the query fails", async () => {
    const client = makeMockClient({ error: { message: "boom" } });
    await expect(getActivePlanId(client)).rejects.toMatchObject({
      code: "db_error",
    });
  });
});

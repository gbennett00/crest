import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import {
  buildUserMessage,
  costOf,
  formatToolResult,
  runAskAgent,
  type CreateMessage,
  type RunSql,
} from "./agent";
import { formatSchema } from "./schema";

const usage = (input: number, output: number): Anthropic.Usage =>
  ({ input_tokens: input, output_tokens: output, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }) as Anthropic.Usage;

function message(stop_reason: Anthropic.StopReason, content: unknown[]): Anthropic.Message {
  return { id: "m", type: "message", role: "assistant", model: "x", content, stop_reason, usage: usage(1000, 100) } as unknown as Anthropic.Message;
}

const toolUse = (id: string, sql: string) => ({ type: "tool_use", id, name: "run_sql", input: { sql, purpose: "p" } });
const text = (t: string) => ({ type: "text", text: t });

const baseInput = { question: "How much did I spend on groceries?", schema: "table x(id uuid)", today: "2026-11-09" };

describe("runAskAgent", () => {
  it("runs the model's SQL, feeds the rows back and returns the answer", async () => {
    const createMessage = vi
      .fn<CreateMessage>()
      .mockResolvedValueOnce(message("tool_use", [toolUse("t1", "select 1")]))
      .mockResolvedValueOnce(message("end_turn", [text("You spent $42.00.")]));
    const runSql = vi.fn<RunSql>().mockResolvedValue({ rows: [{ total_cents: 4200 }], truncated: false });

    const result = await runAskAgent(baseInput, { createMessage, runSql });

    expect(result.answer).toBe("You spent $42.00.");
    expect(result.queries).toEqual([
      { sql: "select 1", purpose: "p", rows: [{ total_cents: 4200 }], truncated: false },
    ]);
    expect(runSql).toHaveBeenCalledWith("select 1", 200);
    const second = createMessage.mock.calls[1][0];
    const toolResult = (second.messages[2].content as Anthropic.ToolResultBlockParam[])[0];
    expect(toolResult).toMatchObject({ type: "tool_result", tool_use_id: "t1" });
    expect(JSON.parse(toolResult.content as string)).toEqual({
      row_count: 1,
      truncated: false,
      rows: [{ total_cents: 4200 }],
    });
  });

  it("returns database errors to the model so it can fix the query", async () => {
    const createMessage = vi
      .fn<CreateMessage>()
      .mockResolvedValueOnce(message("tool_use", [toolUse("t1", "select nope")]))
      .mockResolvedValueOnce(message("tool_use", [toolUse("t2", "select 1")]))
      .mockResolvedValueOnce(message("end_turn", [text("Done.")]));
    const runSql = vi
      .fn<RunSql>()
      .mockRejectedValueOnce(new Error('column "nope" does not exist'))
      .mockResolvedValueOnce({ rows: [], truncated: false });

    const result = await runAskAgent(baseInput, { createMessage, runSql });

    expect(result.queries.map((q) => q.error)).toEqual(['column "nope" does not exist', undefined]);
    const toolResult = (createMessage.mock.calls[1][0].messages[2].content as Anthropic.ToolResultBlockParam[])[0];
    expect(toolResult).toMatchObject({ is_error: true, content: 'column "nope" does not exist' });
  });

  it("stops after the turn cap", async () => {
    const createMessage = vi.fn<CreateMessage>().mockResolvedValue(message("tool_use", [toolUse("t", "select 1")]));
    const runSql = vi.fn<RunSql>().mockResolvedValue({ rows: [], truncated: false });
    const result = await runAskAgent(baseInput, { createMessage, runSql });
    expect(createMessage).toHaveBeenCalledTimes(8);
    expect(result.answer).toMatch(/too many queries/);
  });

  it("adds up cost across turns", async () => {
    const createMessage = vi
      .fn<CreateMessage>()
      .mockResolvedValueOnce(message("tool_use", [toolUse("t1", "select 1")]))
      .mockResolvedValueOnce(message("end_turn", [text("ok")]));
    const runSql = vi.fn<RunSql>().mockResolvedValue({ rows: [], truncated: false });
    const result = await runAskAgent(baseInput, { createMessage, runSql });
    // 2 turns x (1000 in @ $0.10/M + 100 out @ $0.50/M)
    expect(result.costUsd).toBeCloseTo(2 * (0.0001 + 0.00005), 10);
    expect(result.tokens).toEqual({ input: 2000, output: 200 });
  });
});

describe("buildUserMessage", () => {
  it("includes the previous SQL, answer and feedback on a retry", () => {
    const msg = buildUserMessage({
      ...baseInput,
      retry: { queries: ["select 1"], answer: "$5", feedback: "you forgot refunds" },
    });
    expect(msg).toContain("Today is 2026-11-09.");
    expect(msg).toContain("select 1");
    expect(msg).toContain("It answered:\n$5");
    expect(msg).toContain("you forgot refunds");
  });

  it("is just the date and question on a first attempt", () => {
    expect(buildUserMessage(baseInput)).toBe(
      "Today is 2026-11-09.\n\nQuestion: How much did I spend on groceries?",
    );
  });
});

describe("formatToolResult", () => {
  it("cuts oversized results and says so", () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({ i, pad: "x".repeat(500) }));
    const out = formatToolResult({ rows, truncated: false });
    expect(out.length).toBeLessThanOrEqual(30_000);
    const parsed = JSON.parse(out);
    expect(parsed.row_count).toBe(200);
    expect(parsed.truncated).toBe(true);
    expect(parsed.rows_shown).toBeLessThan(200);
  });
});

describe("costOf", () => {
  it("prices cache reads and writes", () => {
    const u = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 1_000_000, cache_read_input_tokens: 1_000_000 } as Anthropic.Usage;
    expect(costOf(u)).toBeCloseTo(0.125 + 0.01, 10);
  });
});

describe("formatSchema", () => {
  it("lists tables, views and enums", () => {
    expect(
      formatSchema(
        [
          { table_name: "accounts", table_type: "BASE TABLE", columns: "id uuid, name text" },
          { table_name: "account_balances", table_type: "VIEW", columns: "account_id uuid" },
        ],
        [{ name: "account_type", labels: "checking, savings" }],
      ),
    ).toBe(
      "table accounts(id uuid, name text)\nview account_balances(account_id uuid)\nenum account_type: checking, savings",
    );
  });
});

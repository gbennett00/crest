import type Anthropic from "@anthropic-ai/sdk";
import { DOMAIN_NOTES } from "./schema";

// Claude Haiku 5.5: the cheapest current Claude model. A typical question
// (system prompt + 1-3 queries + answer) is ~10-30k input tokens, i.e. a
// fraction of a cent.
export const ASK_MODEL = "claude-haiku-5-5";
// USD per million tokens (prompts under 100k tokens).
const PRICE = { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 };

export const MAX_ROWS = 200;
const MAX_TURNS = 8;
const MAX_RESULT_CHARS = 30_000;

export type SqlResult = { rows: Record<string, unknown>[]; truncated: boolean };
/** Runs read-only SQL; throws an Error whose message is the database error. */
export type RunSql = (sql: string, maxRows: number) => Promise<SqlResult>;
export type CreateMessage = (
  params: Anthropic.MessageCreateParamsNonStreaming,
) => Promise<Anthropic.Message>;

export type AskQuery = {
  sql: string;
  purpose: string;
  rows?: Record<string, unknown>[];
  truncated?: boolean;
  error?: string;
};

export type AskRetry = {
  /** SQL the previous attempt ran. */
  queries: string[];
  answer: string;
  /** What the user says was wrong. */
  feedback: string;
};

export type AskInput = {
  question: string;
  retry?: AskRetry;
  /** Introspected schema text (see loadSchemaDescription). */
  schema: string;
  /** YYYY-MM-DD, for "this month"/"last year" questions. */
  today: string;
};

export type AskResult = {
  answer: string;
  queries: AskQuery[];
  costUsd: number;
  tokens: { input: number; output: number };
};

const RUN_SQL_TOOL: Anthropic.Tool = {
  name: "run_sql",
  description:
    "Run one read-only PostgreSQL query (SELECT or WITH ... SELECT, no semicolons) against the user's budget " +
    `database and get the rows back as JSON. At most ${MAX_ROWS} rows are returned, so aggregate in SQL ` +
    "rather than fetching raw rows. Errors come back as the Postgres error message; fix the query and retry.",
  input_schema: {
    type: "object",
    properties: {
      sql: { type: "string", description: "The PostgreSQL query." },
      purpose: { type: "string", description: "One short sentence: what this query finds out." },
    },
    required: ["sql", "purpose"],
    additionalProperties: false,
  },
  strict: true,
};

export function buildSystemPrompt(schema: string): string {
  return `You answer questions about the user's personal budget by querying its PostgreSQL database with the run_sql tool.

How to work:
- Always query the data before answering; never guess numbers. Prefer one well-aggregated query; use more only when needed.
- Only SELECT queries are possible (the database is read-only for you). Do not try to change data.
- Show money as dollars with two decimals (e.g. $1,234.56). Spending is usually reported as a positive amount.
- If the question is ambiguous, pick the most reasonable reading, say which one you used, and answer.
- Final answer: a short, direct reply in plain text or simple Markdown (bullets or a small table are fine). Do not include SQL in it; the user can already see your queries.

${DOMAIN_NOTES}

Schema (public schema; columns are "name type"):
${schema}`;
}

export function buildUserMessage(input: AskInput): string {
  const parts = [`Today is ${input.today}.`, `Question: ${input.question}`];
  if (input.retry) {
    const queries = input.retry.queries.length
      ? input.retry.queries.map((q, i) => `Query ${i + 1}:\n${q}`).join("\n\n")
      : "(no queries)";
    parts.push(
      "A previous attempt at this question was not accurate.",
      `It ran:\n${queries}`,
      `It answered:\n${input.retry.answer}`,
      `The user's feedback: ${input.retry.feedback}`,
      "Take the feedback into account, query again, and give a corrected answer.",
    );
  }
  return parts.join("\n\n");
}

/** JSON for the model, cut to a size budget so a wide result can't blow up the prompt. */
export function formatToolResult(result: SqlResult): string {
  const payload = { row_count: result.rows.length, truncated: result.truncated, rows: result.rows };
  const json = JSON.stringify(payload);
  if (json.length <= MAX_RESULT_CHARS) return json;
  // Drop rows from the end until it fits.
  let rows = result.rows;
  let out = json;
  while (rows.length > 0 && out.length > MAX_RESULT_CHARS) {
    rows = rows.slice(0, Math.floor(rows.length * 0.75));
    out = JSON.stringify({
      row_count: result.rows.length,
      rows_shown: rows.length,
      truncated: true,
      note: "Result too large; only the first rows are shown. Aggregate in SQL instead.",
      rows,
    });
  }
  return out;
}

export function costOf(usage: Anthropic.Usage): number {
  return (
    (usage.input_tokens * PRICE.input +
      (usage.cache_creation_input_tokens ?? 0) * PRICE.cacheWrite +
      (usage.cache_read_input_tokens ?? 0) * PRICE.cacheRead +
      usage.output_tokens * PRICE.output) /
    1_000_000
  );
}

function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

/**
 * Natural language -> SQL -> answer. The model calls run_sql as many times as
 * it needs (capped), sees results or errors, then writes the answer. Stateless:
 * a retry carries the previous SQL, answer and feedback in the request.
 */
export async function runAskAgent(
  input: AskInput,
  deps: { createMessage: CreateMessage; runSql: RunSql },
): Promise<AskResult> {
  const system = buildSystemPrompt(input.schema);
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: buildUserMessage(input) }];
  const queries: AskQuery[] = [];
  let costUsd = 0;
  const tokens = { input: 0, output: 0 };

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await deps.createMessage({
      model: ASK_MODEL,
      max_tokens: 16000,
      output_config: { effort: "low" },
      cache_control: { type: "ephemeral" },
      system,
      tools: [RUN_SQL_TOOL],
      messages,
    });
    costUsd += costOf(response.usage);
    tokens.input +=
      response.usage.input_tokens +
      (response.usage.cache_creation_input_tokens ?? 0) +
      (response.usage.cache_read_input_tokens ?? 0);
    tokens.output += response.usage.output_tokens;

    if (response.stop_reason === "tool_use") {
      messages.push({ role: "assistant", content: response.content });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        const { sql, purpose } = block.input as { sql: string; purpose: string };
        try {
          const result = await deps.runSql(sql, MAX_ROWS);
          queries.push({ sql, purpose, rows: result.rows, truncated: result.truncated });
          results.push({ type: "tool_result", tool_use_id: block.id, content: formatToolResult(result) });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          queries.push({ sql, purpose, error: message });
          results.push({ type: "tool_result", tool_use_id: block.id, content: message, is_error: true });
        }
      }
      messages.push({ role: "user", content: results });
      continue;
    }

    const text = textOf(response);
    if (response.stop_reason === "end_turn" || response.stop_reason === "stop_sequence") {
      return { answer: text || "(No answer.)", queries, costUsd, tokens };
    }
    if (response.stop_reason === "refusal") {
      return { answer: "The model declined to answer this question.", queries, costUsd, tokens };
    }
    // max_tokens, pause_turn or anything unexpected: return what we have.
    return {
      answer: text || `The model stopped early (${response.stop_reason ?? "unknown reason"}). Try rephrasing.`,
      queries,
      costUsd,
      tokens,
    };
  }

  return {
    answer: "Gave up after too many queries without reaching an answer. Try a more specific question.",
    queries,
    costUsd,
    tokens,
  };
}

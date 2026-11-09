import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { MAX_ROWS, runAskAgent, type AskResult, type AskRetry, type RunSql, type SqlResult } from "@/lib/ask/agent";
import { loadSchemaDescription } from "@/lib/ask/schema";

export type AskRequest =
  | { mode: "sql"; sql: string }
  | { mode: "ask"; question: string; retry?: AskRetry };

export type AskSqlResponse = SqlResult;
export type AskAgentResponse = AskResult;

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Nothing is stored: each request carries everything it needs (a retry sends
// the previous SQL, answer and feedback along with the question).
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  let body: AskRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  // Every query, whether typed by the user or written by the model, goes
  // through ai_readonly_query, which forces a read-only transaction in the DB.
  const runSql: RunSql = async (sql, maxRows) => {
    const { data, error } = await supabase.rpc("ai_readonly_query", { p_sql: sql, p_max_rows: maxRows });
    if (error) throw new Error(error.message);
    return data as SqlResult;
  };

  if (body.mode === "sql") {
    if (typeof body.sql !== "string" || !body.sql.trim()) {
      return NextResponse.json({ error: "Enter a query." }, { status: 400 });
    }
    try {
      const result: AskSqlResponse = await runSql(body.sql, MAX_ROWS);
      return NextResponse.json(result);
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }
  }

  if (body.mode !== "ask" || typeof body.question !== "string" || !body.question.trim()) {
    return NextResponse.json({ error: "Enter a question." }, { status: 400 });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not set, so questions can't be answered. Plain SQL still works." },
      { status: 503 },
    );
  }

  const client = new Anthropic();
  try {
    const schema = await loadSchemaDescription(runSql);
    const result: AskAgentResponse = await runAskAgent(
      { question: body.question.trim(), retry: body.retry, schema, today: localToday() },
      { createMessage: (params) => client.messages.create(params), runSql },
    );
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: "Rate limited by the AI provider. Try again shortly." }, { status: 429 });
    }
    if (err instanceof Anthropic.AuthenticationError) {
      return NextResponse.json({ error: "The AI provider rejected ANTHROPIC_API_KEY." }, { status: 502 });
    }
    if (err instanceof Anthropic.APIError) {
      return NextResponse.json({ error: `AI provider error: ${err.message}` }, { status: 502 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

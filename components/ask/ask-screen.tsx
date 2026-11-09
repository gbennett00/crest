"use client";

import { useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import type { AskQuery, AskResult, SqlResult } from "@/lib/ask/agent";
import { formatCellValue, formatCost, resultColumns } from "@/lib/ask/format";
import { cn } from "@/lib/utils";

type Mode = "ask" | "sql";

const FIELD =
  "w-full rounded-ds-md border bg-surface px-3 py-2 text-[16px] leading-6 text-ink placeholder:text-ink-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";

async function post<T>(body: unknown): Promise<T> {
  const res = await fetch("/api/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({ error: `Request failed (${res.status}).` }));
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status}).`);
  return json as T;
}

export function AskScreen() {
  const [mode, setMode] = useState<Mode>("ask");
  const [sql, setSql] = useState("");

  function editSql(query: string) {
    setSql(query);
    setMode("sql");
  }

  return (
    <div className="space-y-4">
      <Segmented
        aria-label="Mode"
        options={[
          { value: "ask", label: "Ask" },
          { value: "sql", label: "SQL" },
        ]}
        value={mode}
        onChange={setMode}
      />
      {/* Both stay mounted so switching tabs keeps each one's state. */}
      <div hidden={mode !== "ask"}>
        <AskPanel onEditSql={editSql} />
      </div>
      <div hidden={mode !== "sql"}>
        <SqlPanel sql={sql} onSqlChange={setSql} />
      </div>
    </div>
  );
}

function AskPanel({ onEditSql }: { onEditSql: (sql: string) => void }) {
  const [question, setQuestion] = useState("");
  const [askedQuestion, setAskedQuestion] = useState("");
  const [result, setResult] = useState<AskResult | null>(null);
  const [feedback, setFeedback] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask(retry?: AskResult) {
    const q = retry ? askedQuestion : question.trim();
    if (!q) return;
    setPending(true);
    setError(null);
    try {
      const next = await post<AskResult>({
        mode: "ask",
        question: q,
        retry: retry
          ? { queries: retry.queries.map((x) => x.sql), answer: retry.answer, feedback: feedback.trim() }
          : undefined,
      });
      setAskedQuestion(q);
      setResult(next);
      setFeedback("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          ask();
        }}
      >
        <textarea
          aria-label="Question"
          className={cn(FIELD, "min-h-[88px] resize-y")}
          placeholder="e.g. What were my top 5 spending categories last month?"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) ask();
          }}
        />
        <div className="flex justify-end">
          <Button type="submit" disabled={pending || !question.trim()}>
            {pending && !result ? <Loader2 className="animate-spin" /> : null}
            Ask
          </Button>
        </div>
      </form>

      {error && <ErrorBanner message={error} />}

      {result && (
        <section className="overflow-hidden rounded-ds-lg border bg-surface">
          <div className="space-y-1 px-4 py-3">
            <p className="text-caption text-ink-muted">{askedQuestion}</p>
            <p className="whitespace-pre-wrap break-words text-body text-ink">{result.answer}</p>
            <p className="text-caption text-ink-subtle">
              {result.queries.length} {result.queries.length === 1 ? "query" : "queries"} ·{" "}
              {formatCost(result.costUsd)}
            </p>
          </div>

          {result.queries.map((q, i) => (
            <QueryDetails key={i} index={i} query={q} onEdit={() => onEditSql(q.sql)} />
          ))}

          <form
            className="space-y-2 border-t px-4 py-3"
            onSubmit={(e) => {
              e.preventDefault();
              ask(result);
            }}
          >
            <label htmlFor="ask-feedback" className="text-body-strong text-ink">
              Not right?
            </label>
            <textarea
              id="ask-feedback"
              className={cn(FIELD, "min-h-[64px] resize-y")}
              placeholder="Say what's wrong, e.g. “exclude transfers” or “I meant October”"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
            />
            <div className="flex justify-end">
              <Button type="submit" variant="secondary" disabled={pending || !feedback.trim()}>
                {pending ? <Loader2 className="animate-spin" /> : null}
                Try again
              </Button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}

function QueryDetails({ index, query, onEdit }: { index: number; query: AskQuery; onEdit: () => void }) {
  return (
    <details className="group border-t">
      <summary className="flex min-h-tap cursor-pointer list-none items-center gap-2 px-4 py-2 text-body text-ink">
        <span className="text-caption text-ink-subtle">#{index + 1}</span>
        <span className="min-w-0 flex-1 truncate">{query.purpose || "Query"}</span>
        {query.error ? (
          <span className="text-caption text-neg-text">failed</span>
        ) : (
          <span className="text-caption text-ink-muted">
            {query.rows?.length ?? 0}
            {query.truncated ? "+" : ""} {query.rows?.length === 1 ? "row" : "rows"}
          </span>
        )}
      </summary>
      <div className="space-y-2 px-4 pb-3">
        <pre className="overflow-x-auto rounded-ds-sm bg-surface-sunken p-3 font-mono text-[13px] leading-5 text-ink">
          {query.sql}
        </pre>
        {query.error && <ErrorBanner message={query.error} />}
        {query.rows && <ResultsTable result={{ rows: query.rows, truncated: !!query.truncated }} />}
        <div className="flex justify-end">
          <Button type="button" variant="quiet" size="sm" onClick={onEdit}>
            Edit &amp; run SQL
          </Button>
        </div>
      </div>
    </details>
  );
}

function SqlPanel({ sql, onSqlChange }: { sql: string; onSqlChange: (sql: string) => void }) {
  const [result, setResult] = useState<SqlResult | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (!sql.trim()) return;
    setPending(true);
    setError(null);
    try {
      setResult(await post<SqlResult>({ mode: "sql", sql }));
    } catch (err) {
      setResult(null);
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
      >
        <textarea
          aria-label="SQL"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          className={cn(FIELD, "min-h-[160px] resize-y font-mono text-[14px] md:text-[14px]")}
          placeholder="select name, type from accounts order by name"
          value={sql}
          onChange={(e) => onSqlChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) run();
          }}
        />
        <div className="flex items-center justify-between gap-2">
          <p className="text-caption text-ink-subtle">Read-only · up to 200 rows</p>
          <Button type="submit" disabled={pending || !sql.trim()}>
            {pending ? <Loader2 className="animate-spin" /> : null}
            Run
          </Button>
        </div>
      </form>

      {error && <ErrorBanner message={error} />}
      {result && (
        <section className="overflow-hidden rounded-ds-lg border bg-surface p-3">
          <ResultsTable result={result} />
        </section>
      )}
    </div>
  );
}

function ResultsTable({ result }: { result: SqlResult }) {
  const columns = resultColumns(result.rows);
  if (result.rows.length === 0) {
    return <p className="text-caption text-ink-muted">No rows.</p>;
  }
  return (
    <div className="space-y-1">
      <div className="max-h-[420px] overflow-auto rounded-ds-sm border">
        <table className="w-full border-collapse text-left text-[13px] leading-5">
          <thead className="sticky top-0 bg-surface-sunken">
            <tr>
              {columns.map((c) => (
                <th key={c} className="whitespace-nowrap px-2 py-1.5 font-semibold text-ink-muted">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row, i) => (
              <tr key={i} className="border-t">
                {columns.map((c) => (
                  <td key={c} className="num max-w-[320px] truncate whitespace-nowrap px-2 py-1 text-ink">
                    {formatCellValue(row[c])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-caption text-ink-subtle">
        {result.rows.length} {result.rows.length === 1 ? "row" : "rows"}{result.truncated ? " (limit reached; more exist)" : ""}
      </p>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-ds-md bg-neg-bg px-3 py-2 text-body text-neg-ink">
      <AlertCircle size={18} className="mt-0.5 shrink-0" />
      <span className="min-w-0 break-words">{message}</span>
    </div>
  );
}

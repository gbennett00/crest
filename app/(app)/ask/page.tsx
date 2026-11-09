import { AskScreen } from "@/components/ask/ask-screen";

export default function AskPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-6 md:px-10 md:py-8">
      <div>
        <h1 className="text-title text-ink">Ask your data</h1>
        <p className="text-caption text-ink-muted">
          Ask a question in plain English or write SQL. Queries are read-only and nothing is saved.
        </p>
      </div>
      <AskScreen />
    </div>
  );
}

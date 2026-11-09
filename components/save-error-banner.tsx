"use client";

import Link from "next/link";
import { AlertCircle, X } from "lucide-react";
import { clearSaveError, useSaveError } from "@/lib/queries/save-error-store";

/**
 * Reports an optimistic save that the server then rejected (see
 * lib/queries/optimistic.ts). The change has already been rolled back on
 * screen; this says so, and why. Floats where the rule prompt does, above it,
 * and stays until dismissed or followed.
 */
export function SaveErrorBanner() {
  const error = useSaveError();
  if (!error) return null;

  return (
    <div
      className="fixed inset-x-0 z-40 px-4 bottom-[calc(var(--dock-bottom)+6.25rem)] md:bottom-4 md:left-auto md:right-4 md:w-[26rem] md:px-0"
      role="alert"
    >
      <div className="flex items-start gap-2.5 rounded-ds-lg border bg-surface-raised p-3 shadow-float">
        <AlertCircle size={16} className="mt-0.5 shrink-0 text-neg-text" aria-hidden />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-body-strong text-ink">{error.title ?? "Couldn’t save your change."}</p>
          <p className="text-caption text-ink-muted">{error.message}</p>
          {error.retryHref && (
            <Link
              href={error.retryHref}
              onClick={clearSaveError}
              className="inline-block text-caption font-semibold text-brand-text"
            >
              Try again
            </Link>
          )}
        </div>
        <button
          type="button"
          onClick={clearSaveError}
          className="shrink-0 text-ink-muted hover:text-ink"
          aria-label="Dismiss"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}

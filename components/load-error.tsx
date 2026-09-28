"use client";

import { Button } from "@/components/ui/button";

/** Shown in place of a screen whose data failed to load, instead of an empty
 * (and misleading) screen or an endless loading skeleton. */
export function LoadError({
  what,
  error,
  onRetry,
}: {
  what: string;
  error: Error;
  onRetry: () => void;
}) {
  return (
    <div className="p-6 flex flex-col items-center gap-3 text-center">
      <p className="text-sm font-medium">Couldn&rsquo;t load your {what}.</p>
      <p className="text-xs text-muted-foreground max-w-md break-words">{error.message}</p>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

"use client";

import { useSyncExternalStore } from "react";

/**
 * The one save failure currently on show (see SaveErrorBanner). Optimistic
 * writes (lib/queries/optimistic.ts) finish after the screen that started
 * them may be gone, e.g. the edit page navigates back before its save lands,
 * so their errors can't live in that screen's state. In memory only, like
 * the rule prompt store.
 */
export type SaveError = {
  /** What failed, e.g. "Couldn’t save Coffee Co." */
  title?: string;
  /** Why, usually the server's message. */
  message: string;
  /** Where to go to try again, e.g. the transaction's edit page. */
  retryHref?: string;
};

let current: SaveError | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function showSaveError(error: SaveError) {
  current = error;
  emit();
}

/** The error currently on show, outside React (useSaveError inside it). */
export function getSaveError(): SaveError | null {
  return current;
}

export function clearSaveError() {
  if (current === null) return;
  current = null;
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSaveError(): SaveError | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
}

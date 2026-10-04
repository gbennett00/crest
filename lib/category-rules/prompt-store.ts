"use client";

import { useSyncExternalStore } from "react";
import type { RulePrompt } from "./types";

/**
 * Client-side state for the "make this a rule?" banner: the one prompt
 * currently on offer (in memory — it only needs to survive the client-side
 * navigation back from the edit form), plus the payees the user dismissed it
 * for on this device (localStorage, keyed by normalized payee).
 */

const DISMISSED_KEY = "crest.rulePrompt.dismissedPayees";
// Plenty for one household; oldest dismissals drop off first.
const MAX_DISMISSED = 500;

let current: RulePrompt | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function readDismissed(): string[] {
  try {
    const raw = window.localStorage.getItem(DISMISSED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === "string") : [];
  } catch {
    return [];
  }
}

export function isRulePromptDismissed(payeeKey: string): boolean {
  return readDismissed().includes(payeeKey);
}

/** Offers a prompt unless the user already dismissed it for this payee. */
export function offerRulePrompt(prompt: RulePrompt) {
  if (isRulePromptDismissed(prompt.payeeKey)) return;
  current = prompt;
  emit();
}

/** Hides the banner without remembering anything (it may be offered again). */
export function clearRulePrompt() {
  if (current === null) return;
  current = null;
  emit();
}

/** "Don't ask again" for this payee on this device, and hides the banner. */
export function dismissRulePrompt(payeeKey: string) {
  try {
    const next = [...readDismissed().filter((k) => k !== payeeKey), payeeKey].slice(-MAX_DISMISSED);
    window.localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable (private mode, blocked): just hide it this time.
  }
  clearRulePrompt();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useRulePrompt(): RulePrompt | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
}

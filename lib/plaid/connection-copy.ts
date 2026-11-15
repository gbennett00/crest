import type { ItemConnection } from "./connection-health";

export type ConnectionCopy = {
  /** Short label for badges ("Needs repair" / "Delayed"). */
  label: string;
  title: string;
  body: string;
  /** Whether to offer the Reconnect (Link update mode) button. */
  canReconnect: boolean;
};

/** "3 days ago", "5 hours ago", "just now". */
export function formatSince(iso: string, now: Date = new Date()): string {
  const diffMs = now.getTime() - Date.parse(iso);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const hours = Math.floor(diffMs / 3_600_000);
  if (hours < 1) return "just now";
  if (hours < 48) return rtf.format(-hours, "hour");
  return rtf.format(-Math.floor(hours / 24), "day");
}

/** User-facing copy for a connection's health; null when there's nothing to say. */
export function connectionCopy(
  connection: ItemConnection,
  now: Date = new Date(),
): ConnectionCopy | null {
  const bank = connection.institutionName ?? "your bank";

  if (connection.state === "needs_repair") {
    switch (connection.reason) {
      case "expiring":
        return {
          label: "Needs repair",
          title: "Connection expiring soon",
          body: `Access to ${bank} ends soon. Reconnect to keep transactions importing.`,
          canReconnect: true,
        };
      case "bank_action_required":
        return {
          label: "Needs repair",
          title: "Action needed at your bank",
          body: `${bank} is blocking access until you sign in on its website (for example to unlock your account or reset your password). Do that first, then reconnect.`,
          canReconnect: true,
        };
      case "revoked":
        return {
          label: "Needs repair",
          title: "Connection lost",
          body: `Crest no longer has access to ${bank}. Try reconnecting. If that doesn't work, disconnect and link the bank again.`,
          canReconnect: true,
        };
      default:
        return {
          label: "Needs repair",
          title: "Connection needs repair",
          body: `${bank} needs you to sign in again before new transactions can import.`,
          canReconnect: true,
        };
    }
  }

  if (connection.state === "delayed") {
    const since = connection.lastSuccessfulUpdate
      ? ` Last update ${formatSince(connection.lastSuccessfulUpdate, now)}.`
      : "";
    return {
      label: "Delayed",
      title: "Imports delayed",
      body:
        connection.reason === "institution_issue"
          ? `${bank} is having trouble connecting right now. Transactions will catch up on their own once it's back; you don't need to do anything.${since}`
          : `Crest is having trouble getting updates from ${bank}. This usually resolves on its own; you don't need to do anything.${since}`,
      canReconnect: false,
    };
  }

  return null;
}

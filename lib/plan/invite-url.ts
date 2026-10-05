import { headers } from "next/headers";

/**
 * Absolute base URL for building links that are shared outside the app (e.g.
 * invite links the inviter sends to someone else). Prefers NEXT_PUBLIC_APP_URL
 * when set; otherwise derives it from the incoming request's forwarded host.
 */
export async function getAppBaseUrl(): Promise<string> {
  const envBase = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (envBase) return envBase;

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto =
    h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/** The shareable invite link for a token. */
export async function buildInviteUrl(token: string): Promise<string> {
  const base = await getAppBaseUrl();
  return `${base}/invite/${token}`;
}

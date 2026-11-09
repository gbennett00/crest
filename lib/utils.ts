import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// The design system's type scale (tailwind.config.ts `fontSize`). Without
// this, tailwind-merge reads `text-caption` as a colour and drops it when a
// real colour such as `text-ink-muted` comes later in the same cn() call.
const DS_FONT_SIZES = [
  "amount-hero",
  "title-lg",
  "title",
  "headline",
  "body",
  "body-strong",
  "amount",
  "pill",
  "caption",
  "overline",
  "row-label",
  "amount-sm",
  "banner-amount",
];

const twMerge = extendTailwindMerge({
  extend: { classGroups: { "font-size": [{ text: DS_FONT_SIZES }] } },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// This check can be removed, it is just for tutorial purposes
export const hasEnvVars =
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

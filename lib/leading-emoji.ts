// Category names are user-owned and often start with an emoji the user picked
// ("💖 Dating"). The Plan table gives that emoji its own column, so split it off.
// Handles ZWJ sequences, skin tones, variation selectors and flags.
const LEADING_EMOJI =
  /^((?:\p{Regional_Indicator}{2}|\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})?(?:‍\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})?)*))\s*/u;

export function splitLeadingEmoji(name: string): { emoji: string | null; label: string } {
  const match = LEADING_EMOJI.exec(name);
  if (!match) return { emoji: null, label: name };
  const label = name.slice(match[0].length);
  // A name that is nothing but an emoji keeps it as the label.
  if (!label) return { emoji: null, label: name };
  return { emoji: match[1], label };
}

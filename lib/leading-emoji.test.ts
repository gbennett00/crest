import { describe, expect, it } from "vitest";
import { splitLeadingEmoji } from "./leading-emoji";

describe("splitLeadingEmoji", () => {
  it("splits a leading emoji from the label", () => {
    expect(splitLeadingEmoji("💖 Dating")).toEqual({ emoji: "💖", label: "Dating" });
  });

  it("leaves names without an emoji alone", () => {
    expect(splitLeadingEmoji("Dining out")).toEqual({ emoji: null, label: "Dining out" });
  });

  it("only takes an emoji at the start", () => {
    expect(splitLeadingEmoji("Dining 🍽️ out")).toEqual({ emoji: null, label: "Dining 🍽️ out" });
  });

  it("keeps variation selectors, skin tones and ZWJ sequences whole", () => {
    expect(splitLeadingEmoji("🍽️ Dining out").emoji).toBe("🍽️");
    expect(splitLeadingEmoji("👍🏽 Thumbs").emoji).toBe("👍🏽");
    expect(splitLeadingEmoji("👨‍👩‍👧 Family").emoji).toBe("👨‍👩‍👧");
  });

  it("keeps a flag whole", () => {
    expect(splitLeadingEmoji("🇺🇸 Travel")).toEqual({ emoji: "🇺🇸", label: "Travel" });
  });

  it("does not treat digits as emoji", () => {
    expect(splitLeadingEmoji("401k")).toEqual({ emoji: null, label: "401k" });
  });

  it("keeps an emoji-only name as its label", () => {
    expect(splitLeadingEmoji("💖")).toEqual({ emoji: null, label: "💖" });
  });

  it("handles an empty name", () => {
    expect(splitLeadingEmoji("")).toEqual({ emoji: null, label: "" });
  });
});

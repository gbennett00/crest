import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("keeps a design-system text size next to a text colour", () => {
    expect(cn("text-body-strong text-brand-ink")).toBe("text-body-strong text-brand-ink");
    expect(cn("text-caption", "text-ink-muted")).toBe("text-caption text-ink-muted");
  });

  it("still lets a later size override an earlier one", () => {
    expect(cn("text-body-strong", "text-[15px]")).toBe("text-[15px]");
    expect(cn("text-caption", "text-headline")).toBe("text-headline");
  });
});

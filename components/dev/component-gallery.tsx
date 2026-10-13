"use client";

import { useState } from "react";
import { Plus } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { AvailablePill } from "@/components/ui/available-pill";
import { Segmented } from "@/components/ui/segmented";
import { Sheet } from "@/components/ui/sheet";
import { ReadyToAssignBanner } from "@/components/budget/ready-to-assign-banner";

const THEMES = ["light", "dark"] as const;

/** Re-themes its subtree: the token variables are keyed on these attributes. */
function ThemePanel({ theme, children }: { theme: (typeof THEMES)[number]; children: React.ReactNode }) {
  return (
    <div
      data-theme={theme}
      className={cn("min-w-0 space-y-3 rounded-ds-lg border bg-background p-4 text-foreground", theme === "dark" && "dark")}
    >
      <p className="text-overline uppercase text-ink-muted">{theme}</p>
      {children}
    </div>
  );
}

function Section({ title, children }: { title: string; children: (theme: (typeof THEMES)[number]) => React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-headline">{title}</h2>
      <div className="grid gap-4 md:grid-cols-2">
        {THEMES.map((theme) => (
          <ThemePanel key={theme} theme={theme}>
            {children(theme)}
          </ThemePanel>
        ))}
      </div>
    </section>
  );
}

export function ComponentGallery() {
  const [direction, setDirection] = useState("out");
  const [range, setRange] = useState("month");
  const [sheet, setSheet] = useState<"short" | "tall" | "step" | null>(null);
  const [step, setStep] = useState(0);

  return (
    <div className="space-y-8 p-4">
      <div>
        <h1 className="text-title-lg">Component gallery</h1>
        <p className="text-caption text-ink-muted">
          Dev only. Each panel re-themes via data-theme, except portalled sheets, which follow the app theme.
        </p>
      </div>

      <Section title="Button">
        {() => (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <Button>Save assignments</Button>
              <Button variant="secondary">Cancel</Button>
              <Button variant="quiet">Select</Button>
              <Button variant="destructive">Delete</Button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button size="sm">Review</Button>
              <Button size="sm" variant="secondary">Manage</Button>
              <Button disabled>Disabled</Button>
              <Button size="icon" aria-label="Add"><Plus /></Button>
            </div>
          </>
        )}
      </Section>

      <Section title="Available pill">
        {() => (
          <>
            <div className="flex flex-wrap gap-3">
              <AvailablePill cents={68_787} />
              <AvailablePill cents={1_240} state="warn" />
              <AvailablePill cents={-4_800} />
              <AvailablePill cents={0} />
            </div>
            <div className="flex justify-end">
              <AvailablePill cents={2_909_923} />
            </div>
          </>
        )}
      </Section>

      <Section title="Segmented">
        {() => (
          <>
            <Segmented
              aria-label="Direction"
              value={direction}
              onChange={setDirection}
              options={[
                { value: "out", label: "Out" },
                { value: "in", label: "In" },
                { value: "transfer", label: "Transfer" },
              ]}
            />
            <Segmented
              aria-label="Range"
              value={range}
              onChange={setRange}
              options={[
                { value: "month", label: "This month" },
                { value: "3", label: "Last 3 mo" },
                { value: "6", label: "Last 6 mo" },
                { value: "year", label: "This year" },
                { value: "all", label: "All time" },
              ]}
            />
          </>
        )}
      </Section>

      <Section title="Ready to assign banner">
        {() => (
          <>
            <ReadyToAssignBanner cents={185_422} onPress={() => setSheet("short")} />
            <ReadyToAssignBanner cents={0} />
            <ReadyToAssignBanner cents={-12_000} onPress={() => setSheet("short")} />
          </>
        )}
      </Section>

      <section className="space-y-3">
        <h2 className="text-headline">Sheet</h2>
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" onClick={() => setSheet("short")}>Short form</Button>
          <Button variant="secondary" onClick={() => setSheet("tall")}>Drawer (tall)</Button>
          <Button variant="secondary" onClick={() => { setStep(0); setSheet("step"); }}>Step with back</Button>
        </div>
      </section>

      <Sheet
        open={sheet === "short"}
        onOpenChange={(o) => !o && setSheet(null)}
        title="Add group"
        footer={
          <>
            <Button variant="secondary" className="flex-1" onClick={() => setSheet(null)}>Cancel</Button>
            <Button className="flex-1" onClick={() => setSheet(null)}>Add group</Button>
          </>
        }
      >
        <label className="text-caption text-ink-muted" htmlFor="gallery-name">Name</label>
        <input
          id="gallery-name"
          placeholder="Group name"
          className="mt-1.5 h-12 w-full rounded-ds-md border border-border-strong bg-surface-sunken px-4 text-body placeholder:text-ink-subtle"
        />
      </Sheet>

      <Sheet
        open={sheet === "tall"}
        onOpenChange={(o) => !o && setSheet(null)}
        title="Review"
        tall
        footer={<Button className="flex-1" onClick={() => setSheet(null)}>Approve all 10</Button>}
      >
        <ul>
          {Array.from({ length: 24 }, (_, i) => (
            <li key={i} className="flex h-row-list items-center border-t first:border-t-0">
              Row {i + 1}
            </li>
          ))}
        </ul>
      </Sheet>

      <Sheet
        open={sheet === "step"}
        onOpenChange={(o) => !o && setSheet(null)}
        title={step === 0 ? "Move money" : "Choose category"}
        onBack={step === 1 ? () => setStep(0) : undefined}
      >
        {step === 0 ? (
          <Button variant="secondary" onClick={() => setStep(1)}>Choose category</Button>
        ) : (
          <p className="text-ink-muted">Replaced in place, never stacked.</p>
        )}
      </Sheet>
    </div>
  );
}

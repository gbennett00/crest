import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        chart: {
          "1": "hsl(var(--chart-1))",
          "2": "hsl(var(--chart-2))",
          "3": "hsl(var(--chart-3))",
          "4": "hsl(var(--chart-4))",
          "5": "hsl(var(--chart-5))",
          "6": "hsl(var(--chart-6))",
        },
        // Design system tokens (see the `--ds-*` variables in app/globals.css).
        // Hex-valued, so no opacity modifiers. `border` and `chart-*` are the
        // shadcn keys above, valued from the same tokens.
        bg: "var(--ds-bg)",
        surface: {
          DEFAULT: "var(--ds-surface)",
          raised: "var(--ds-surface-raised)",
          sunken: "var(--ds-surface-sunken)",
        },
        "border-strong": "var(--ds-border-strong)",
        ink: {
          DEFAULT: "var(--ds-ink)",
          muted: "var(--ds-ink-muted)",
          subtle: "var(--ds-ink-subtle)",
        },
        brand: {
          DEFAULT: "var(--ds-brand)",
          ink: "var(--ds-brand-ink)",
          text: "var(--ds-brand-text)",
          subtle: "var(--ds-brand-subtle)",
        },
        pos: { bg: "var(--ds-pos-bg)", ink: "var(--ds-pos-ink)", text: "var(--ds-pos-text)" },
        warn: { bg: "var(--ds-warn-bg)", ink: "var(--ds-warn-ink)" },
        neg: { bg: "var(--ds-neg-bg)", ink: "var(--ds-neg-ink)", text: "var(--ds-neg-text)" },
        zero: { bg: "var(--ds-zero-bg)", ink: "var(--ds-zero-ink)" },
        focus: "var(--ds-focus)",
        scrim: "var(--ds-scrim)",
      },
      fontFamily: {
        sans: [
          "var(--font-inter)",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "sans-serif",
        ],
      },
      // Type scale from the design system. `text-body` etc. set size, line
      // height, weight and tracking together. Add the `num` class to any
      // currency figure for tabular numerals.
      fontSize: {
        "amount-hero": ["44px", { lineHeight: "48px", fontWeight: "700", letterSpacing: "-0.02em" }],
        "title-lg": ["30px", { lineHeight: "36px", fontWeight: "700", letterSpacing: "-0.01em" }],
        title: ["22px", { lineHeight: "28px", fontWeight: "600" }],
        headline: ["17px", { lineHeight: "24px", fontWeight: "600" }],
        body: ["16px", { lineHeight: "22px", fontWeight: "400" }],
        "body-strong": ["16px", { lineHeight: "22px", fontWeight: "600" }],
        amount: ["16px", { lineHeight: "22px", fontWeight: "600" }],
        pill: ["14px", { lineHeight: "18px", fontWeight: "600" }],
        caption: ["13px", { lineHeight: "18px", fontWeight: "500" }],
        overline: ["12px", { lineHeight: "16px", fontWeight: "600", letterSpacing: "0.06em" }],
        "row-label": ["14px", { lineHeight: "20px", fontWeight: "400" }],
        "amount-sm": ["15px", { lineHeight: "20px", fontWeight: "600" }],
        "banner-amount": ["24px", { lineHeight: "28px", fontWeight: "700", letterSpacing: "-0.01em" }],
      },
      spacing: {
        tap: "44px",
        "tabbar-clearance": "112px",
        "dock-inset": "12px",
        "row-dense": "52px",
        "row-list": "64px",
      },
      boxShadow: {
        float: "var(--shadow-float)",
        sheet: "var(--shadow-sheet)",
      },
      borderRadius: {
        // Design system radii. Prefixed because Tailwind's own `sm`..`xl` keys
        // are in use across unmigrated pages.
        "ds-sm": "8px",
        "ds-md": "14px",
        "ds-lg": "20px",
        "ds-xl": "28px",
        pill: "999px",
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  plugins: [require("tailwindcss-animate")],
} satisfies Config;

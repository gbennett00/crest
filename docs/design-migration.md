# Design system migration

Crest is being moved, page by page, onto a new design system. **Read this before
doing any UI work.** It records the decisions made so far so each chunk of work
stays consistent.

## Sources of truth

Design lives in claude.ai artifacts (not in this repo). They need the owner's
Claude account to open:

- Design system (tokens, README, component cards):
  https://claude.ai/code/artifact/4a2ddda8-b5ac-43ac-a985-45776623db9c?org=094a3311-4dd4-4eff-94d5-3050f739cee7
- Page designs (boards for Plan, Home, and later pages):
  https://claude.ai/code/artifact/ccf8eb7e-c966-4404-937c-02e3eae12c65?org=094a3311-4dd4-4eff-94d5-3050f739cee7

Read the design system's `project/README.md` (layout rules, content rules) and
the relevant component card before building a component. Do not guess values.
If you cannot open the artifacts, say so and ask; do not invent a design.

## Approach: migrate in place, nothing may break

- **One shell, one set of tokens, applied app-wide.** There is no second layout,
  no `legacy/` folder and no parallel route group.
- **Unmigrated pages must keep working** while they wait their turn. They are
  written against the shadcn variable names (`bg-background`, `text-primary`,
  `border-border`, `bg-muted`...). Those names still exist but now take their
  values from the new design system (see "Token layers").
- **Each page migration rewrites that page's feature components in place**
  (`components/budget/*`, `components/home/*`, ...), so old versions never
  linger as dead code.
- **Shared primitives that already exist** (`Button`, `Badge`, `Input`, `Card`,
  `Modal`, `MoneyKeypad`) are restyled in place **with their props unchanged**,
  so every old call site keeps compiling. Genuinely new primitives (Pill,
  Sheet, Drawer, banner...) are added next to them in `components/ui/`. Add a
  new component only when a page needs it.
- **Final cleanup PR** (after the last page): delete the shadcn alias
  variables from `app/globals.css`, the matching shadcn keys in
  `tailwind.config.ts`, and any primitive with no remaining callers.

## Token layers (`app/globals.css`, `tailwind.config.ts`)

1. **`--ds-*` variables**: the design system tokens, hex, one block per theme.
   Tailwind keys: `bg-bg`, `bg-surface`, `bg-surface-raised`,
   `bg-surface-sunken`, `text-ink`, `text-ink-muted`, `text-ink-subtle`,
   `bg-brand` / `text-brand-ink` / `text-brand-text` / `bg-brand-subtle`,
   `bg-pos-bg text-pos-ink`, `bg-warn-bg text-warn-ink`, `bg-neg-bg text-neg-ink`,
   `bg-zero-bg text-zero-ink`, `text-pos-text`, `text-neg-text`, `border-strong`,
   `focus`, `scrim`. **New code uses these.** They are hex, so opacity
   modifiers (`bg-surface/50`) do not work; use a different token instead.
2. **shadcn aliases** (`--background`, `--primary`, ...): HSL triplets valued
   from the same tokens, for unmigrated code and for `border`, `ring`,
   `chart-1..6`. **Do not use in new code** except `border`/`ring`/`chart-*`,
   which have no separate new key. Mapping notes:
   - `--primary` = `brand-text` (not `brand`): old pages use `text-primary`, and
     mint is unreadable as text on light. New filled actions use
     `bg-brand text-brand-ink`.
   - `--destructive` = `neg-text` in both themes.
   - `--radius` is 14px (`radius-md`); Tailwind `rounded-lg/md/sm` derive from it.
3. **Type scale**: `text-title-lg`, `text-title`, `text-headline`, `text-body`,
   `text-body-strong`, `text-amount`, `text-amount-sm`, `text-pill`,
   `text-caption`, `text-overline`, `text-row-label`, `text-banner-amount`,
   `text-amount-hero`. Each sets size, line height, weight and tracking. Add
   the `num` class to every currency figure (tabular numerals).
4. **Radii**: `rounded-ds-sm|md|lg|xl` and `rounded-pill`. Prefixed because
   Tailwind's own `sm`..`xl` are used across unmigrated pages; do not override
   those keys.
5. **Spacing/shadow**: `h-tap`, `pb-tabbar-clearance`, `h-row-dense`,
   `h-row-list`, `shadow-float`, `shadow-sheet`. The `space-N` tokens are
   Tailwind's own `1,2,3,4,5,6,8` steps.

## Conventions

- **Themes**: next-themes sets both the `dark` class and `data-theme`. Style
  with Tailwind `dark:` or the CSS variables; never hardcode a hex in a
  component.
- **Font**: Inter, loaded in `app/layout.tsx` as `--font-inter`. Inputs stay
  16px (iOS zoom); the `globals.css` mobile rules for that stay.
- **Plan is an edge-to-edge table; Home and Reports use cards.** Do not mix on
  one screen. Dense rows use `text-row-label`; everything else 16px.
- **Value first** in rows pairing an amount with a label; the Plan banner is
  the one exception. Negatives use a true minus (`-$46.63`) and never rely on
  colour alone.
- **One overlay pattern: the Sheet** (tall lists use the drawer form).
- **Bottom dock**: scrolling screens reserve `pb-tabbar-clearance` (112px).
  The shell owns this, so pages do not add their own.
- Tappable targets are at least 44px (`h-tap`/`min-h-tap`).
- Match this repo's conventions (shadcn-style files in `components/ui`, `cn()`,
  co-located tests). Do not copy preview CSS from the design artifacts.

## How to do a chunk of work

1. Read this file, the design system README, and the card(s) for what you build.
2. Build against the tokens above. Run `pnpm lint`, `pnpm test`, `pnpm build`.
3. Per CLAUDE.md, check the real routes in `pnpm dev`, in light **and** dark,
   at phone width (390px). Check pages you did *not* migrate still look right.
4. Tick the page off below, update anything here that changed, one PR per page
   (or per small batch).

## Status

Order: tokens, shell + primitives (with a dev gallery at `app/dev/gallery`,
hidden in production), Plan, Home, then the rest in batches.

- [x] Tokens, Inter, type scale, theme attributes
- [ ] Shell (tab bar dock, Add button, bottom clearance) and primitives
- [ ] `/budget` (Plan), `/budget/category/[id]`, `/budget/moves`
- [ ] `/` (Home)
- [ ] `/transactions`, `/transactions/[id]`
- [ ] `/accounts`, `/accounts/[id]`
- [ ] `/reports`, `/reports/spending`
- [ ] `/rules`, `/members`, `/import`
- [ ] Settings/user menu, auth pages
- [ ] Cleanup: remove shadcn aliases and dead primitives
- [ ] Decide PWA `themeColor` / manifest colours (currently `#0d946e`, unchanged)

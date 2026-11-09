/**
 * Where a bottom sheet must sit while the on-screen keyboard is open.
 *
 * On iOS a `position: fixed; bottom: 0` element is laid out against the
 * layout viewport, which the keyboard does not shrink: the keyboard covers its
 * bottom and Safari scrolls the visual viewport to show the focused field. A
 * tall sheet then pokes out above the visible area (its search field
 * included) and, with the page scroll-locked, can't be scrolled back. Pinning
 * the sheet's bottom to the visual viewport's bottom and capping its height
 * to what is visible keeps it all on screen.
 */

export type ViewportMetrics = {
  /** Layout viewport height (document.documentElement.clientHeight). */
  layoutHeight: number;
  /** window.visualViewport.height */
  visualHeight: number;
  /** window.visualViewport.offsetTop: how far it is scrolled down the layout viewport. */
  visualOffsetTop: number;
  /** window.visualViewport.scale: pinch-zoom, which also shrinks visualHeight. */
  scale: number;
};

export type KeyboardFrame = {
  /** CSS `bottom` in px, from the layout viewport's bottom edge. */
  bottom: number;
  /** The visible height above the keyboard, less a small gap. A tall sheet uses it as its height. */
  maxHeight: number;
};

/** Below this the difference is browser chrome, not a keyboard. */
const KEYBOARD_MIN_PX = 120;
/** Visible gap kept above the sheet so it still reads as a sheet. */
const TOP_GAP_PX = 8;

/** Null when no keyboard is open (or the page is pinch-zoomed): keep the normal CSS frame. */
export function keyboardFrame(m: ViewportMetrics): KeyboardFrame | null {
  if (Math.abs(m.scale - 1) > 0.01) return null;
  const hidden = m.layoutHeight - m.visualHeight;
  if (hidden < KEYBOARD_MIN_PX) return null;

  return {
    bottom: Math.max(0, Math.round(m.layoutHeight - (m.visualOffsetTop + m.visualHeight))),
    maxHeight: Math.max(0, Math.round(m.visualHeight - TOP_GAP_PX)),
  };
}

export function sameFrame(a: KeyboardFrame | null, b: KeyboardFrame | null): boolean {
  if (a === null || b === null) return a === b;
  return a.bottom === b.bottom && a.maxHeight === b.maxHeight;
}

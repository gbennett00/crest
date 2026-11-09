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
};

export type SheetFrame = {
  /** CSS `bottom` in px, from the layout viewport's bottom edge. */
  bottom: number;
  maxHeight: number;
  /** Set for the tall (drawer) form, which fills the visible height. */
  height?: number;
};

/** Below this the difference is browser chrome, not a keyboard. */
const KEYBOARD_MIN_PX = 120;
/** Visible gap kept above the sheet so it still reads as a sheet. */
const TOP_GAP_PX = 8;

/** Null when no keyboard is open: the sheet keeps its normal CSS frame. */
export function keyboardSheetFrame(m: ViewportMetrics, tall: boolean): SheetFrame | null {
  const hidden = m.layoutHeight - m.visualHeight;
  if (hidden < KEYBOARD_MIN_PX) return null;

  const bottom = Math.max(0, m.layoutHeight - (m.visualOffsetTop + m.visualHeight));
  const maxHeight = Math.max(0, m.visualHeight - TOP_GAP_PX);
  return tall ? { bottom, maxHeight, height: maxHeight } : { bottom, maxHeight };
}

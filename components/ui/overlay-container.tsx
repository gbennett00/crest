"use client";

import * as React from "react";

/**
 * Where a hand-rolled portal (category picker, money keypad, Modal) should
 * render. Normally `document.body`, but inside a Sheet that is wrong: the
 * Sheet is a modal Radix Dialog, which makes everything outside its content
 * inert (no pointer events, focus pulled back, scroll locked). The Sheet
 * provides a node inside its content here so overlays opened from within it
 * stay interactive.
 */
export const OverlayContainerContext = React.createContext<HTMLElement | null>(null);

/** Portal target for an overlay: the enclosing Sheet's container, else the body. */
export function usePortalTarget(): HTMLElement | null {
  const container = React.useContext(OverlayContainerContext);
  return container ?? (typeof document === "undefined" ? null : document.body);
}

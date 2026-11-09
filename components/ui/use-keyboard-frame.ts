"use client";

import { useEffect, useState } from "react";
import { keyboardSheetFrame, type SheetFrame } from "@/lib/keyboard-frame";

/**
 * While `active`, tracks the visual viewport and returns the frame a bottom
 * sheet needs to stay above the on-screen keyboard (see lib/keyboard-frame.ts),
 * or null when no keyboard is open or the browser has no visualViewport.
 */
export function useKeyboardSheetFrame(active: boolean, tall: boolean): SheetFrame | null {
  const [frame, setFrame] = useState<SheetFrame | null>(null);

  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!active || !vv) {
      setFrame(null);
      return;
    }
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() =>
        setFrame(
          keyboardSheetFrame(
            {
              layoutHeight: document.documentElement.clientHeight,
              visualHeight: vv.height,
              visualOffsetTop: vv.offsetTop,
            },
            tall,
          ),
        ),
      );
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      cancelAnimationFrame(raf);
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, [active, tall]);

  return frame;
}

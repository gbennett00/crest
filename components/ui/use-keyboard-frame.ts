"use client";

import { useEffect, useState } from "react";
import { keyboardFrame, sameFrame, type KeyboardFrame } from "@/lib/keyboard-frame";

/**
 * While `active`, tracks the visual viewport and returns where a bottom sheet
 * must sit to stay above the on-screen keyboard (see lib/keyboard-frame.ts),
 * or null when no keyboard is open or the browser has no visualViewport.
 * The returned object only changes when the frame does, so viewport scroll
 * events don't re-render the sheet every frame.
 */
export function useKeyboardFrame(active: boolean): KeyboardFrame | null {
  const [frame, setFrame] = useState<KeyboardFrame | null>(null);

  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!active || !vv) {
      setFrame(null);
      return;
    }
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const next = keyboardFrame({
          layoutHeight: document.documentElement.clientHeight,
          visualHeight: vv.height,
          visualOffsetTop: vv.offsetTop,
          scale: vv.scale,
        });
        setFrame((prev) => (sameFrame(prev, next) ? prev : next));
      });
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      cancelAnimationFrame(raf);
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, [active]);

  return frame;
}

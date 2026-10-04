"use client";

import { useCallback, useEffect, useRef } from "react";
import type React from "react";

// How long a touch must be held, and how far the finger may drift, before it
// counts as a long press. The drift allowance matters on real devices: a
// held finger jitters a few pixels, and cancelling on any movement makes the
// gesture unreliable.
const HOLD_MS = 500;
const MOVE_TOLERANCE_PX = 10;

// Long-pressing these should keep their native behavior (caret placement,
// paste menu) instead of opening the row menu.
const IGNORE_SELECTOR = "input, textarea, select, [contenteditable='true']";

// Touch long-press + right-click handler that reports the press point.
//
// iOS Safari never fires `contextmenu` for a long press, so touch/pen presses
// are timed manually. Android and desktop do fire `contextmenu` (long press /
// right-click / keyboard menu key), which is handled too. The click that can
// follow a long press is swallowed so the row's own tap action doesn't run.
export function useLongPress(
  onLongPress: (point: { x: number; y: number }) => void,
  { disabled = false }: { disabled?: boolean } = {},
) {
  const timerRef = useRef<number | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const firedRef = useRef(false);
  const callbackRef = useRef(onLongPress);
  callbackRef.current = onLongPress;

  const clear = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    startRef.current = null;
  }, []);

  useEffect(() => clear, [clear]);
  useEffect(() => {
    if (disabled) clear();
  }, [disabled, clear]);

  const fire = useCallback(
    (point: { x: number; y: number }) => {
      clear();
      firedRef.current = true;
      navigator.vibrate?.(10);
      callbackRef.current(point);
    },
    [clear],
  );

  // Events from portaled children (e.g. the open menu itself) bubble through
  // React's tree; only presses on the element's own DOM subtree count.
  function isOwnTarget(e: React.SyntheticEvent<HTMLElement>) {
    const target = e.target as Element;
    return (
      e.currentTarget.contains(target) && !target.closest(IGNORE_SELECTOR)
    );
  }

  const onPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    firedRef.current = false;
    if (disabled || e.pointerType === "mouse" || !isOwnTarget(e)) return;
    clear();
    const point = { x: e.clientX, y: e.clientY };
    startRef.current = point;
    timerRef.current = window.setTimeout(() => fire(point), HOLD_MS);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const start = startRef.current;
    if (!start) return;
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > MOVE_TOLERANCE_PX) {
      clear();
    }
  };

  const onContextMenu = (e: React.MouseEvent<HTMLElement>) => {
    if (disabled || !isOwnTarget(e)) return;
    e.preventDefault();
    // Android fires this alongside our own timer; open only once.
    if (firedRef.current) return;
    // Keyboard-invoked menus report (0, 0); anchor to the element instead.
    if (e.clientX === 0 && e.clientY === 0) {
      const rect = e.currentTarget.getBoundingClientRect();
      fire({ x: rect.left + 16, y: rect.bottom });
    } else {
      fire({ x: e.clientX, y: e.clientY });
    }
  };

  const onClickCapture = (e: React.MouseEvent<HTMLElement>) => {
    if (!firedRef.current) return;
    firedRef.current = false;
    e.preventDefault();
    e.stopPropagation();
  };

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: clear,
    onPointerCancel: clear,
    onPointerLeave: clear,
    onContextMenu,
    onClickCapture,
  };
}

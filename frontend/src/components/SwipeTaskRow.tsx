"use client";

import { useRef, useState, type ReactNode } from "react";

const THRESHOLD = 72;

/**
 * Wraps a task row with swipe-right-to-complete and swipe-left-to-skip.
 * Desktop click actions still work through the row's normal buttons.
 */
export function SwipeTaskRow({
  children,
  onComplete,
  onSkip,
}: {
  children: ReactNode;
  onComplete: () => void;
  onSkip?: () => void;
}) {
  const [offset, setOffset] = useState(0);
  const startX = useRef(0);
  const dragging = useRef(false);

  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    dragging.current = true;
    startX.current = e.clientX;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragging.current) return;
    const dx = e.clientX - startX.current;
    const min = onSkip ? -THRESHOLD : 0;
    setOffset(Math.max(min, Math.min(THRESHOLD, dx)));
  }

  function onPointerUp(e: React.PointerEvent) {
    if (!dragging.current) return;
    dragging.current = false;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // Pointer capture may already be released by the browser.
    }

    if (offset >= THRESHOLD * 0.6) {
      setOffset(0);
      onComplete();
    } else if (onSkip && offset <= -THRESHOLD * 0.6) {
      setOffset(0);
      onSkip();
    } else {
      setOffset(0);
    }
  }

  const showComplete = offset > THRESHOLD * 0.6;
  const showSkip = onSkip && offset < -THRESHOLD * 0.6;

  return (
    <div style={{ position: "relative", overflow: "hidden", touchAction: "pan-y" }}>
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: "0 auto 0 0",
          width: THRESHOLD,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: showComplete ? "var(--sage, #4a7c5f)" : "var(--line, #e8e4dc)",
          transition: "background 0.15s",
          fontSize: 11,
          fontFamily: "var(--font-mono)",
          color: showComplete ? "var(--bg, #fff)" : "var(--ink-3, #999)",
        }}
      >
        done
      </div>

      {onSkip && (
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: "0 0 0 auto",
            width: THRESHOLD,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: showSkip ? "var(--mustard, #c9a227)" : "var(--line, #e8e4dc)",
            transition: "background 0.15s",
            fontSize: 11,
            fontFamily: "var(--font-mono)",
            color: showSkip ? "var(--bg, #fff)" : "var(--ink-3, #999)",
          }}
        >
          skip
        </div>
      )}

      <div
        style={{
          transform: `translateX(${offset}px)`,
          transition: dragging.current ? "none" : "transform 0.2s ease",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {children}
      </div>
    </div>
  );
}

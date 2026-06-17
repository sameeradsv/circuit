"use client";

import { useRef, useState, type ReactNode } from "react";

const THRESHOLD = 72;

/**
 * Wraps a task row with swipe-left-to-complete on touch/pointer devices.
 * On desktop the row renders as-is with no visual change.
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
    // Clamp: swipe-left only (negative), up to 2× threshold for skip reveal
    const max = onSkip ? THRESHOLD * 2 : THRESHOLD;
    setOffset(Math.max(-max, Math.min(0, dx)));
  }

  function onPointerUp(e: React.PointerEvent) {
    if (!dragging.current) return;
    dragging.current = false;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }

    if (onSkip && offset <= -(THRESHOLD * 1.5)) {
      setOffset(0);
      onSkip();
    } else if (offset <= -THRESHOLD * 0.6) {
      setOffset(0);
      onComplete();
    } else {
      setOffset(0);
    }
  }

  const showSkip = onSkip && offset < -THRESHOLD;

  return (
    <div style={{ position: "relative", overflow: "hidden" }}>
      {/* Revealed action layer */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: "0 0 0 auto",
          width: THRESHOLD * (onSkip ? 2 : 1),
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
        }}
      >
        {/* Skip zone (deeper swipe, right side of reveal) */}
        {onSkip && (
          <div style={{
            width: THRESHOLD,
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: showSkip ? "var(--mustard, #c9a227)" : "var(--line, #e8e4dc)",
            transition: "background 0.15s",
            fontSize: 11,
            fontFamily: "var(--font-mono)",
            color: showSkip ? "var(--bg, #fff)" : "var(--ink-3, #999)",
          }}>
            skip
          </div>
        )}
        {/* Complete zone */}
        <div style={{
          width: THRESHOLD,
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--sage, #4a7c5f)",
          fontSize: 11,
          fontFamily: "var(--font-mono)",
          color: "var(--bg, #fff)",
        }}>
          done ✓
        </div>
      </div>

      {/* Draggable row */}
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

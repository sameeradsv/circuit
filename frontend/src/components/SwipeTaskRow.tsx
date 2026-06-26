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
  const lastOffset = useRef(0);
  const dragging = useRef(false);
  const moved = useRef(false);

  function setSwipeOffset(next: number) {
    lastOffset.current = next;
    setOffset(next);
  }

  function isInteractiveTarget(target: EventTarget | null) {
    return target instanceof Element
      && Boolean(target.closest("button, a, input, textarea, select, [role='button']"));
  }

  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    if (isInteractiveTarget(e.target)) return;
    dragging.current = true;
    moved.current = false;
    startX.current = e.clientX;
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragging.current) return;
    const dx = e.clientX - startX.current;
    const min = onSkip ? -THRESHOLD : 0;
    const next = Math.max(min, Math.min(THRESHOLD, dx));
    moved.current = moved.current || Math.abs(dx) > 8;
    if (moved.current && !(e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
    setSwipeOffset(next);
  }

  function onPointerUp(e: React.PointerEvent) {
    if (!dragging.current) return;
    dragging.current = false;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // Pointer capture may already be released by the browser.
    }

    const finalOffset = lastOffset.current;
    if (finalOffset >= THRESHOLD * 0.6) {
      setSwipeOffset(0);
      onComplete();
    } else if (onSkip && finalOffset <= -THRESHOLD * 0.6) {
      setSwipeOffset(0);
      onSkip();
    } else {
      setSwipeOffset(0);
    }
  }

  const showComplete = offset > THRESHOLD * 0.6;
  const showSkip = onSkip && offset < -THRESHOLD * 0.6;
  const revealingComplete = offset > 4;
  const revealingSkip = onSkip && offset < -4;

  return (
    <div style={{ position: "relative", overflow: "hidden", touchAction: "pan-y", borderRadius: 12 }}>
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
          opacity: revealingComplete ? 1 : 0,
          transition: "background 0.15s, opacity 0.12s",
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
            opacity: revealingSkip ? 1 : 0,
            transition: "background 0.15s, opacity 0.12s",
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
          background: "var(--paper)",
          borderRadius: 12,
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClickCapture={(e) => {
          if (moved.current) {
            e.preventDefault();
            e.stopPropagation();
            moved.current = false;
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}

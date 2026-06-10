import { useEffect, useMemo, useRef, useState } from "react";
import "./ShelfRow.css";

export type Spine = {
  id: string;
  title: string;
  author?: string;
  // optional: widen some spines for realism (defaults to "m")
  width?: "s" | "m" | "l";
  heightPx?: number;
  fontSizePx?: number;
};

export type ShelfRowProps = {
  shelfLabel?: string;          // e.g. "Top shelf"
  spines: Spine[];
  heightPx?: number;            // shelf row visual height
  onSpineClick?: (spine: Spine) => void;
};

export default function ShelfRow({
  shelfLabel,
  spines,
  onSpineClick,
}: ShelfRowProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const drag = useRef({
    isDown: false,
    locked: "none" as "none" | "x" | "y",
    startX: 0,
    startY: 0,
    startScrollLeft: 0,
    moved: false,
    pointerId: null as number | null,
  });

  const widthClass = useMemo(() => {
    // just in case you want to tune per-shelf later
    return "shelfRow";
  }, []);

  function updateScrollCues() {
    const el = scrollerRef.current;
    if (!el) return;

    // Use a small epsilon to avoid weird fractional scroll values on iOS
    const eps = 2;

    setCanScrollLeft(el.scrollLeft > eps);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - eps);
  }

  useEffect(() => {
    updateScrollCues();

    const el = scrollerRef.current;
    if (!el) return;

    const onScroll = () => updateScrollCues();
    el.addEventListener("scroll", onScroll, { passive: true });

    // ResizeObserver helps when orientation changes / layout changes on phone
    const ro = new ResizeObserver(() => updateScrollCues());
    ro.observe(el);

    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spines.length]);

  return (
    <div className={widthClass}>
      {shelfLabel ? <div className="shelfLabel">{shelfLabel}</div> : null}

      <div className="shelfRowInner">
        <div className="spineViewport">
          <div
            ref={scrollerRef}
            className="spineScroller"
            aria-label={shelfLabel ? `Shelf spines: ${shelfLabel}` : "Shelf spines"}
            onPointerDown={(e) => {
              const el = scrollerRef.current;
              if (!el) return;

              drag.current.isDown = true;
              drag.current.locked = "none";
              drag.current.startX = e.clientX;
              drag.current.startY = e.clientY;
              drag.current.startScrollLeft = el.scrollLeft;
              drag.current.moved = false;
              drag.current.pointerId = e.pointerId;

              // Capture the pointer to continue receiving events even if it goes outside the element
              el.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              const el = scrollerRef.current;
              if (!el) return;
              if (!drag.current.isDown) return;
              if (drag.current.pointerId !== e.pointerId) return;

              const dx = e.clientX - drag.current.startX;
              const dy = e.clientY - drag.current.startY;

              // Decide direction once the user has moved a bit
              if (drag.current.locked === "none") {
                const adx = Math.abs(dx);
                const ady = Math.abs(dy);
                const threshold = 6;

                if (adx > threshold || ady > threshold) {
                  drag.current.locked = adx > ady ? "x" : "y";
                }
              }

              // If horizontal intent, drag-scroll the shelf and prevent page pan
              if (drag.current.locked === "x") {
                e.preventDefault();
                el.scrollLeft = drag.current.startScrollLeft - dx;
                drag.current.moved = true;
                updateScrollCues();
              }
              // If vertical intent, do nothing; page scroll works normally
            }}
            onPointerUp={(e) => {
              const el = scrollerRef.current;

              if (el && drag.current.pointerId === e.pointerId) {
                el.releasePointerCapture(e.pointerId);
              }

              drag.current.isDown = false;
              drag.current.locked = "none";
              drag.current.pointerId = null;
            }}
            onPointerCancel={(e) => {
              const el = scrollerRef.current;

              if (el && drag.current.pointerId === e.pointerId) {
                el.releasePointerCapture(e.pointerId);
              }

              drag.current.isDown = false;
              drag.current.locked = "none";
              drag.current.pointerId = null;
            }}
          >
            {spines.map((spine) => (
              <button
                key={spine.id}
                className={`spine spine-${spine.width ?? "m"}`}
                style={
                  {
                    "--spineHeight": spine.heightPx ? `${spine.heightPx}px` : undefined,
                    "--spineFontSize": spine.fontSizePx
                      ? `${spine.fontSizePx}px`
                      : undefined,
                  } as React.CSSProperties
                }
                type="button"
                onClick={() => {
                  if (drag.current.moved) return; // suppress click after a drag
                  onSpineClick?.(spine);
                }}
                title={spine.title}
              >
                <span className="spineText" aria-hidden="true">
                  {spine.title}
                </span>
              </button>
            ))}
          </div>

          {canScrollLeft ? <div className="fadeLeft" aria-hidden="true" /> : null}

          {canScrollRight ? <div className="fadeRight" aria-hidden="true" /> : null}
        </div>
      </div>

      <div className="shelfBoard" aria-hidden="true" />
    </div>
  );
}

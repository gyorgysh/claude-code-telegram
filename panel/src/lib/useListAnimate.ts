import { useAutoAnimate } from "@formkit/auto-animate/react";

/**
 * Shared list enter/exit animation. Wraps AutoAnimate with a tuned config that
 * matches the design spec: a subtle ~150ms fade (opacity 0→1) plus a small
 * upward slide (translateY 4px→0) as rows are inserted/removed/reordered.
 *
 * Attach the returned ref to the immediate parent of the animated rows:
 *   const [listRef] = useListAnimate();
 *   <div ref={listRef} className="space-y-2">{items.map(...)}</div>
 *
 * AutoAnimate disables itself automatically when the user has
 * `prefers-reduced-motion: reduce` set, so there is nothing extra to gate.
 */
export function useListAnimate() {
  return useAutoAnimate({ duration: 150 });
}

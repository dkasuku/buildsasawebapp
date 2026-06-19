// ============================================================================
// ExpandableText — clamps long body/description text and reveals the rest with
// a "Read more" toggle. The toggle only appears when the text actually overflows.
// ============================================================================

import { useState, useRef, useLayoutEffect } from "react";

export function ExpandableText({
  text,
  className = "",
  clampClass = "line-clamp-3",
}: {
  text?: string | null;
  className?: string;
  clampClass?: string; // must be a literal Tailwind class so JIT picks it up
}) {
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el) setOverflowing(el.scrollHeight > el.clientHeight + 1);
  }, [text, expanded]);

  if (!text) return null;

  return (
    <div>
      <div ref={ref} className={`${className} ${expanded ? "whitespace-pre-wrap" : clampClass}`}>
        {text}
      </div>
      {(overflowing || expanded) && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
          className="mt-1 text-[11px] text-[#FF6B1A] hover:underline"
        >
          {expanded ? "Show less" : "Read more"}
        </button>
      )}
    </div>
  );
}

export default ExpandableText;

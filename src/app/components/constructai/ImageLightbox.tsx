// ============================================================================
// ImageLightbox — fullscreen image viewer with prev/next, counter, keyboard
// (←/→/Esc) and click-outside to close. Used wherever multiple images are
// attached (projects, etc.). Always renders on a dark backdrop, so it's
// theme-independent.
// ============================================================================

import { useEffect, useState } from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";

export function ImageLightbox({
  images,
  startIndex = 0,
  onClose,
  videoUrls,
}: {
  images: string[];
  startIndex?: number;
  onClose: () => void;
  videoUrls?: string[]; // any url listed here is rendered as a <video> player
}) {
  const [idx, setIdx] = useState(startIndex);
  const count = images?.length || 0;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") setIdx((i) => (i - 1 + count) % count);
      else if (e.key === "ArrowRight") setIdx((i) => (i + 1) % count);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [count, onClose]);

  if (!count) return null;
  const prev = (e: { stopPropagation: () => void }) => { e.stopPropagation(); setIdx((i) => (i - 1 + count) % count); };
  const next = (e: { stopPropagation: () => void }) => { e.stopPropagation(); setIdx((i) => (i + 1) % count); };

  return (
    <div className="fixed inset-0 z-[80] bg-black/90 flex items-center justify-center p-4" onClick={onClose}>
      <button onClick={onClose} className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 text-white flex items-center justify-center hover:bg-white/20" title="Close (Esc)">
        <X className="w-5 h-5" />
      </button>

      {count > 1 && (
        <button onClick={prev} className="absolute left-3 sm:left-6 w-11 h-11 rounded-full bg-white/10 text-white flex items-center justify-center hover:bg-white/20" title="Previous (←)">
          <ChevronLeft className="w-6 h-6" />
        </button>
      )}

      {videoUrls?.includes(images[idx]) ? (
        <video
          src={images[idx]}
          controls
          autoPlay
          onClick={(e) => e.stopPropagation()}
          className="max-h-[85vh] max-w-[90vw] rounded-lg shadow-2xl bg-black"
        />
      ) : (
        <img
          src={images[idx]}
          alt={`Image ${idx + 1} of ${count}`}
          onClick={(e) => e.stopPropagation()}
          className="max-h-[85vh] max-w-[90vw] object-contain rounded-lg shadow-2xl"
        />
      )}

      {count > 1 && (
        <button onClick={next} className="absolute right-3 sm:right-6 w-11 h-11 rounded-full bg-white/10 text-white flex items-center justify-center hover:bg-white/20" title="Next (→)">
          <ChevronRight className="w-6 h-6" />
        </button>
      )}

      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-white/10 text-white text-[12px]">
        {idx + 1} / {count}
      </div>
    </div>
  );
}

export default ImageLightbox;

// ============================================================================
// EmptyState — friendly "nothing here yet, here's what to do" panel.
// Used across modules so a brand-new workspace never shows a blank screen.
// ============================================================================

import type { ReactNode } from "react";

export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  secondaryLabel,
  onSecondary,
  children,
}: {
  icon?: any;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6">
      {Icon && (
        <div className="relative mb-5 flex items-center justify-center">
          {/* Animated ripple illustration — lively but lightweight, no assets. */}
          <span className="absolute w-16 h-16 rounded-2xl bg-[#FF6B1A]/20 es-ripple" />
          <span className="absolute w-16 h-16 rounded-2xl bg-[#FF6B1A]/15 es-ripple" style={{ animationDelay: "1s" }} />
          <div className="relative w-16 h-16 rounded-2xl bg-[#161C24] border border-[#222A35] flex items-center justify-center es-float">
            <Icon className="w-7 h-7 text-[#FF6B1A]" />
          </div>
          <style>{`
            @keyframes es-ripple { 0% { transform: scale(1); opacity: .55 } 100% { transform: scale(1.9); opacity: 0 } }
            @keyframes es-float { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-6px) } }
            .es-ripple { animation: es-ripple 2.6s ease-out infinite; }
            .es-float { animation: es-float 3s ease-in-out infinite; }
            @media (prefers-reduced-motion: reduce) { .es-ripple, .es-float { animation: none !important; } }
          `}</style>
        </div>
      )}
      <div className="text-[15px] text-white font-display">{title}</div>
      {description && <p className="mt-2 text-[12.5px] text-[#8A95A5] max-w-sm leading-relaxed">{description}</p>}
      {(actionLabel || secondaryLabel) && (
        <div className="mt-5 flex items-center gap-2">
          {actionLabel && (
            <button onClick={onAction} className="h-10 px-5 rounded-md bg-[#FF6B1A] hover:bg-[#FF7E33] text-white text-[12.5px]">
              {actionLabel}
            </button>
          )}
          {secondaryLabel && (
            <button onClick={onSecondary} className="h-10 px-4 rounded-md border border-[#222A35] text-[#8A95A5] hover:text-white text-[12.5px]">
              {secondaryLabel}
            </button>
          )}
        </div>
      )}
      {children}
    </div>
  );
}

export default EmptyState;

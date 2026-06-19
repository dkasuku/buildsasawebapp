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
        <div className="w-14 h-14 rounded-2xl bg-[#161C24] border border-[#222A35] flex items-center justify-center mb-4">
          <Icon className="w-7 h-7 text-[#FF6B1A]" />
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

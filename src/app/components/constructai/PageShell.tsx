// Shared page chrome for workspace modules: a white, edge-to-edge header band
// (title, subtitle, actions, optional tabs) and the one tab strip every page
// uses. Styles live in styles/workspace.css (.ws-pagehead, .ws-tabs, .ws-tab).
import type { ReactNode } from "react";

export type TabItem<T extends string = string> = { id: T; label: ReactNode; count?: number; hidden?: boolean };

/** Horizontal tab strip: orange label and underline on the active tab. */
export function Tabs<T extends string>({ items, value, onChange, label = "Sections", className = "" }: {
  items: TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  /** Accessible name for the tab strip. */
  label?: string;
  className?: string;
}) {
  return (
    <nav className={`ws-tabs ${className}`} aria-label={label}>
      {items.filter((t) => !t.hidden).map((t) => (
        <button key={t.id} type="button" className="ws-tab" aria-current={value === t.id ? "page" : undefined} onClick={() => onChange(t.id)}>
          {t.label}
          {t.count != null && t.count > 0 && <span className="ws-count">{t.count}</span>}
        </button>
      ))}
    </nav>
  );
}

/**
 * White header band that runs the full width of the content area. Put it as
 * the first child of a page, outside the page's padded body.
 */
export function PageHeader({ title, subtitle, actions, tabs, children, bare }: {
  title?: ReactNode;
  subtitle?: ReactNode;
  /** Buttons and filters on the right. One primary button at most. */
  actions?: ReactNode;
  /** Usually a <Tabs />; sits flush with the band's bottom border. */
  tabs?: ReactNode;
  /** Extra rows between the title and the tabs (e.g. a search bar). */
  children?: ReactNode;
  /** Embedded under another page's header: show only the controls, no band. */
  bare?: boolean;
}) {
  if (bare) return <div className="ws-toolbar px-4 sm:px-8 pt-5">{actions}{children}</div>;
  return (
    <header className={`ws-pagehead ${tabs ? "ws-pagehead-tabs" : ""}`}>
      {(title || actions) && (
        <div className="ws-page-head">
          {title ? (
            <div className="min-w-0">
              <h1 className="ws-h1">{title}</h1>
              {subtitle && <div className="ws-sub">{subtitle}</div>}
            </div>
          ) : <span />}
          {actions && <div className="ws-toolbar">{actions}</div>}
        </div>
      )}
      {children}
      {tabs}
    </header>
  );
}

/** The same choices as <Tabs />, as a dropdown. Used for section switchers in page headers. */
export function TabSelect<T extends string>({ items, value, onChange, label = "Sections", className = "" }: {
  items: TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  label?: string;
  className?: string;
}) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value as T)} className={`ws-select h-9 px-3 rounded-md border border-[#222A35] text-[13px] min-w-[180px] ${className}`}>
      {items.filter((t) => !t.hidden).map((t) => (
        <option key={t.id} value={t.id}>{String(t.label)}{t.count != null && t.count > 0 ? ` (${t.count})` : ""}</option>
      ))}
    </select>
  );
}
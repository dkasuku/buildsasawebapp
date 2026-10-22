import {
  LayoutDashboard, CalendarDays, FolderKanban, FileText, Users, Settings, LifeBuoy,
  Mail, Eye, ClipboardCheck, ShieldCheck, Wallet, ChevronDown, ChevronRight, Megaphone, CreditCard, LogOut,
  Lock, Search, SquarePen, X, NotebookPen, FolderOpen, Building2,
} from "lucide-react";
import { useState, useEffect } from "react";
import type { Role } from "./roles";
import { ROLES } from "./roles";
import { isViewVisible } from "../../config/features";
import apiClient, { type UserProfile } from "../../services/api";
import { BUSINESS_VIEWS } from "./planTier";
import { useProjects } from "./useProjects";
import { projectTone, TONE_DOT } from "./wsStatus";

export type View =
  | "login"
  | "dashboard"
  | "projects"
  // Per-project dashboard. Reached from a project card or the current-project
  // row in the Projects tree.
  | "project-detail"
  | "change-orders"
  | "plans"
  | "tasks"
  | "schedule"
  | "documents"
  | "daily-log"
  | "punch-list"
  | "commitments"
  | "field-view"
  | "reports"
  | "financials"
  | "team"
  | "inbox"
  | "announcements"
  | "observations"
  | "action-plans"
  | "coordination"
  | "correspondence"
  | "crews"
  | "directory"
  | "subcontractors"
  | "company-docs"
  | "role-manager"
  | "bidding"
  | "quotes"
  | "jobs"
  | "invoicing"
  | "inspections"
  | "safety-incidents"
  | "equipment"
  | "attendance"
  | "buildflex-ai"
  | "checklists"
  | "billing";

// Role testing (localStorage bf-role-testing=1) is the only case where the
// viewing role can be switched; in production it follows the login.
const ROLE_TESTING = (() => { try { return localStorage.getItem("bf-role-testing") === "1"; } catch { return false; } })();

type Leaf = { key: View; label: string; icon?: any };
type Group = { id: string; label: string; icon: any; items: Leaf[]; defaultOpen?: boolean };
type Entry = { leaf: Leaf } | { group: Group } | { divider: true };

// Linear-style tree: main items, with nested sub-items under a few of them.
const TREE: Entry[] = [
  { leaf: { key: "inbox", label: "Inbox", icon: Mail } },
  { leaf: { key: "dashboard", label: "Dashboard", icon: LayoutDashboard } },
  { leaf: { key: "announcements", label: "Announcements", icon: Megaphone } },
  { divider: true },
  { group: { id: "projects", label: "Projects", icon: FolderKanban, defaultOpen: true, items: [
    { key: "projects", label: "All projects" },
    // The current project is inserted here at render time.
    { key: "change-orders", label: "Change orders" },
    { key: "plans", label: "Plans & drawings" },
  ] } },
  { leaf: { key: "schedule", label: "Schedule", icon: CalendarDays } },
  { leaf: { key: "daily-log", label: "Daily log", icon: NotebookPen } },
  { group: { id: "site", label: "Site checks", icon: ClipboardCheck, defaultOpen: true, items: [
    { key: "checklists", label: "Checklists" },
    { key: "punch-list", label: "Punch list" },
    { key: "observations", label: "Observations" },
  ] } },
  { group: { id: "money", label: "Money", icon: Wallet, items: [
    { key: "financials", label: "Financials" },
    { key: "commitments", label: "Commitments" },
    { key: "quotes", label: "Quotes" },
    { key: "invoicing", label: "Invoicing" },
    { key: "equipment", label: "Inventory" },
    { key: "billing", label: "Billing & plan" },
  ] } },
  { group: { id: "quality", label: "Quality & safety", icon: ShieldCheck, items: [
    { key: "inspections", label: "Inspections" },
    { key: "safety-incidents", label: "Safety incidents" },
  ] } },
  { group: { id: "people", label: "People", icon: Users, items: [
    { key: "directory", label: "Directory" },
    { key: "subcontractors", label: "Subcontractors" },
    { key: "crews", label: "Crews" },
    { key: "team", label: "Team" },
    { key: "attendance", label: "Attendance" },
    { key: "role-manager", label: "Role manager" },
  ] } },
  { group: { id: "docs", label: "Documents & reports", icon: FileText, items: [
    { key: "reports", label: "Reports" },
    { key: "documents", label: "Unfiled documents" },
    { key: "company-docs", label: "Company documents" },
    { key: "correspondence", label: "Correspondence" },
    { key: "coordination", label: "Coordination issues" },
  ] } },
];

const OPEN_KEY = "buildsasa-sidebar-open";

export function Sidebar({
  view,
  setView,
  open,
  onClose,
  role,
  setRole,
  locked = false,
  starter = false,
  activeProjectId,
  onOpenProject,
}: {
  view: View;
  setView: (v: View) => void;
  open: boolean;
  onClose: () => void;
  role: Role;
  setRole?: (r: Role) => void;
  locked?: boolean;
  /** On the Starter plan: Business-only items show a lock. */
  starter?: boolean;
  /** The project last opened, shown as a row under Projects. */
  activeProjectId?: string | null;
  onOpenProject?: (id: string) => void;
}) {
  const perms = ROLES[role];
  const go = (v: View) => {
    setView(v);
    onClose();
  };
  const { projects } = useProjects();
  const current = activeProjectId ? projects.find((p) => p.id === activeProjectId) : undefined;

  // "Unfiled documents" is a queue, not a permanent home: project files live in
  // each project's own folders. Show it only while documents without a project
  // still exist, so a tidy workspace never sees it.
  const [unfiledDocs, setUnfiledDocs] = useState(0);
  useEffect(() => {
    const count = () => apiClient.getUnfiledDocuments().then((d) => setUnfiledDocs(d.length)).catch(() => { /* leave hidden */ });
    count();
    window.addEventListener("buildsasa:documents-filed", count);
    return () => window.removeEventListener("buildsasa:documents-filed", count);
  }, []);
  const allowed = (v: View) => {
    // Keep the item while the user is standing on it, so it cannot vanish
    // underneath them as they file the last document.
    if (v === "documents" && unfiledDocs === 0 && view !== "documents") return false;
    return perms.views.includes(v) && isViewVisible(v);
  };

  // Real logged-in user for the profile row. Refreshes when the profile is
  // edited in Settings.
  const [me, setMe] = useState<UserProfile | null>(null);
  const [menu, setMenu] = useState<null | "user" | "workspace" | "role">(null);
  useEffect(() => {
    const load = () => apiClient.me().then(setMe).catch(() => {});
    load();
    window.addEventListener("buildflex:profile-updated", load);
    return () => window.removeEventListener("buildflex:profile-updated", load);
  }, []);
  const signOut = () => {
    try { localStorage.removeItem("constructai-token"); localStorage.removeItem("constructai-user"); localStorage.removeItem("constructai-refresh"); } catch { /* noop */ }
    go("login");
  };
  const openSettings = (tab?: string) => {
    setMenu(null); onClose();
    window.dispatchEvent(new CustomEvent("buildflex:open-settings", { detail: tab ? { tab } : undefined }));
  };
  const displayName = me?.name || "Your profile";
  const displayRole = me?.role || role;
  const initials = (me?.name || "U").trim().split(/\s+/).map((s) => s[0]).slice(0, 2).join("").toUpperCase() || "U";

  // Which groups are expanded. Remembered; the group holding the current page
  // always opens.
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(OPEN_KEY);
      if (saved) return new Set(JSON.parse(saved));
    } catch { /* noop */ }
    return new Set(TREE.flatMap((e) => ("group" in e && e.group.defaultOpen ? [e.group.id] : [])));
  });
  useEffect(() => {
    try { localStorage.setItem(OPEN_KEY, JSON.stringify(Array.from(expanded))); } catch { /* noop */ }
  }, [expanded]);
  useEffect(() => {
    const g = TREE.find((e) => "group" in e && (e.group.items.some((i) => i.key === view) || (e.group.id === "projects" && view === "project-detail")));
    if (g && "group" in g) setExpanded((prev) => (prev.has(g.group.id) ? prev : new Set(prev).add(g.group.id)));
  }, [view]);
  const toggle = (id: string) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const lock = (k: View) => starter && BUSINESS_VIEWS.includes(k) ? <Lock className="ws-chev" aria-label="Business plan" /> : null;

  const row = (l: Leaf, sub = false) => (
    <button key={l.key} type="button" className="ws-row" aria-current={view === l.key ? "page" : undefined} onClick={() => go(l.key)}>
      {!sub && l.icon && <l.icon aria-hidden />}
      <span className="ws-row-label">{l.label}</span>
      {lock(l.key)}
    </button>
  );

  return (
    <>
      <div
        onClick={onClose}
        className={`fixed inset-0 bg-black/60 z-40 lg:hidden transition-opacity ${open ? "opacity-100" : "opacity-0 pointer-events-none"}`}
      />
      <aside
        aria-label="Workspace navigation"
        className={`ws-sidebar fixed lg:static z-50 shrink-0 transition-transform duration-200 ${open ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}
      >
        <div className="ws-sidebar-top relative">
          <button type="button" className="ws-switcher" onClick={() => setMenu(menu === "workspace" ? null : "workspace")} aria-haspopup="menu" aria-expanded={menu === "workspace"}>
            <img src="/Buildsasa.png" alt="" />
            <span className="truncate">Buildsasa</span>
            <ChevronDown className="w-3.5 h-3.5" style={{ color: "var(--ws-muted)" }} aria-hidden />
          </button>
          <button type="button" className="ws-icon-btn ws-ghost" style={{ width: 32, height: 32 }} aria-label="Search" onClick={() => { onClose(); window.dispatchEvent(new Event("buildsasa:focus-search")); }}><Search /></button>
          <button type="button" className="ws-icon-btn ws-ghost" style={{ width: 32, height: 32 }} aria-label="Create new" onClick={() => { onClose(); window.dispatchEvent(new Event("buildsasa:open-new")); }}><SquarePen /></button>
          <button type="button" className="ws-icon-btn ws-ghost lg:hidden" style={{ width: 32, height: 32 }} aria-label="Close menu" onClick={onClose}><X /></button>
          {menu === "workspace" && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setMenu(null)} />
              <div className="ws-menu" role="menu" style={{ left: 10, right: 10, top: 46 }}>
                <button role="menuitem" className="ws-menu-item" onClick={() => openSettings("company")}><Building2 /> Company settings</button>
                {allowed("billing") && <button role="menuitem" className="ws-menu-item" onClick={() => { setMenu(null); go("billing"); }}><CreditCard /> Billing &amp; plan</button>}
                <button role="menuitem" className="ws-menu-item" onClick={() => { setMenu(null); go("projects"); }}><FolderOpen /> All projects</button>
              </div>
            </>
          )}
        </div>

        <nav className="ws-nav">
          {locked && (
            <button type="button" className="ws-row" aria-current="page" onClick={() => go("billing")} style={{ marginBottom: 8 }}>
              <CreditCard aria-hidden /><span className="ws-row-label">Billing &amp; plan</span>
            </button>
          )}
          <div className={locked ? "blur-sm select-none pointer-events-none opacity-70" : ""} aria-hidden={locked || undefined}>
            {TREE.map((e, i) => {
              if ("divider" in e) return <div key={`d${i}`} className="ws-divider" />;
              if ("leaf" in e) return allowed(e.leaf.key) ? row(e.leaf) : null;
              const g = e.group;
              const items = g.items.filter((l) => allowed(l.key));
              const showCurrent = g.id === "projects" && !!current;
              if (items.length === 0 && !showCurrent) return null;
              const isOpen = expanded.has(g.id);
              return (
                <div key={g.id}>
                  <button type="button" className="ws-row" aria-expanded={isOpen} onClick={() => toggle(g.id)}>
                    <g.icon aria-hidden />
                    <span className="ws-row-label">{g.label}</span>
                    {isOpen ? <ChevronDown className="ws-chev" aria-hidden /> : <ChevronRight className="ws-chev" aria-hidden />}
                  </button>
                  {isOpen && (
                    <div className="ws-subtree">
                      {items.map((l, idx) => (
                        <div key={l.key}>
                          {row(l, true)}
                          {/* Current project sits right after "All projects". */}
                          {idx === 0 && showCurrent && current && (
                            <button type="button" className="ws-row" aria-current={view === "project-detail" ? "page" : undefined} onClick={() => { onOpenProject?.(current.id); onClose(); }} title={current.name}>
                              <span className="ws-dot" style={{ color: TONE_DOT[projectTone(current.status)] }} aria-hidden />
                              <span className="ws-row-label">{current.name}</span>
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </nav>

        <div className="ws-viewing relative">
          Viewing as <strong>{role}</strong>
          {ROLE_TESTING && setRole && (
            <>
              <span aria-hidden>·</span>
              <button type="button" className="ws-link" onClick={() => setMenu(menu === "role" ? null : "role")}>Switch</button>
              {menu === "role" && (
                <>
                  <div className="fixed inset-0 z-20" onClick={() => setMenu(null)} />
                  <div className="ws-menu" role="menu" style={{ left: 0, right: 0, bottom: 34 }}>
                    {(Object.keys(ROLES) as Role[]).map((r) => (
                      <button key={r} role="menuitemradio" aria-checked={r === role} className="ws-menu-item" onClick={() => { setRole(r); setMenu(null); }}>
                        <Eye /> {r}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>
        <div className="relative">
          {menu === "user" && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setMenu(null)} />
              <div className="ws-menu" role="menu" style={{ left: 10, right: 10, bottom: 52 }}>
                <button role="menuitem" className="ws-menu-item" onClick={() => openSettings()}><Settings /> Settings</button>
                <button role="menuitem" className="ws-menu-item" onClick={() => { setMenu(null); window.open("mailto:support@buildsasa.com?subject=Support%20Request", "_blank"); }}><LifeBuoy /> Help &amp; support</button>
                <div className="ws-divider" style={{ margin: "4px 0" }} />
                <button role="menuitem" className="ws-menu-item" style={{ color: "var(--ws-red)" }} onClick={signOut}><LogOut style={{ color: "var(--ws-red)" }} /> Sign out</button>
              </div>
            </>
          )}
          <button type="button" className="ws-user" onClick={() => setMenu(menu === "user" ? null : "user")} aria-haspopup="menu" aria-expanded={menu === "user"}>
            {me?.avatar ? <img src={me.avatar} alt="" className="ws-avatar" /> : <span className="ws-avatar" aria-hidden>{initials}</span>}
            <span className="min-w-0 flex-1">
              <span className="block truncate" style={{ fontSize: 13.5, fontWeight: 500, color: "var(--ws-text)" }}>{displayName}</span>
              <span className="block truncate" style={{ fontSize: 12, color: "var(--ws-muted)" }}>{displayRole}</span>
            </span>
            <ChevronDown className={`w-4 h-4 transition-transform ${menu === "user" ? "rotate-180" : ""}`} style={{ color: "var(--ws-muted)" }} aria-hidden />
          </button>
        </div>
      </aside>
    </>
  );
}


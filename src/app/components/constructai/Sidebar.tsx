import {
  Settings, LifeBuoy, Eye, ChevronDown, CreditCard, LogOut,
  Lock, Search, SquarePen, X, FolderOpen, Building2, Sparkles, PanelLeftClose, PanelLeftOpen, Coins, SunMoon, Box, LayoutGrid } from "lucide-react";
import { useState, useEffect } from "react";
import type { Role } from "./roles";
import { ROLES, roleLabel } from "./roles";
import { isViewVisible } from "../../config/features";
import apiClient, { type UserProfile } from "../../services/api";
import { BUSINESS_VIEWS } from "./planTier";
import { useProjects } from "./useProjects";
import { projectTone, TONE_DOT } from "./wsStatus";
import { MODULES, moduleOf, type Module } from "./modules";
import { useCurrency } from "./CurrencyContext";

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
  | "cost-estimate"
  | "floor-plan"
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

// The last tab opened in each module, so going back to a module lands where
// you left it.
const LAST_KEY = "buildsasa-module-last";

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
  collapsed = false,
  onToggleCollapsed,
  unfiledDocs = 0,
}: {
  /** Desktop only: a narrow rail of icons, labels on hover. */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  /** Documents with no project; their page is only offered while some exist. */
  unfiledDocs?: number;
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
  const { currency, setCurrency } = useCurrency();
  const go = (v: View) => {
    setView(v);
    onClose();
  };
  const { projects } = useProjects();
  const current = activeProjectId ? projects.find((p) => p.id === activeProjectId) : undefined;

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
  const displayRole = roleLabel(me?.role || role);
  const initials = (me?.name || "U").trim().split(/\s+/).map((s) => s[0]).slice(0, 2).join("").toUpperCase() || "U";

  const [last, setLast] = useState<Record<string, View>>(() => {
    try { return JSON.parse(localStorage.getItem(LAST_KEY) || "{}"); } catch { return {}; }
  });
  const active = moduleOf(view);
  useEffect(() => {
    if (!active || view === "project-detail") return;
    setLast((prev) => {
      if (prev[active.id] === view) return prev;
      const next = { ...prev, [active.id]: view };
      try { localStorage.setItem(LAST_KEY, JSON.stringify(next)); } catch { /* noop */ }
      return next;
    });
  }, [view, active]);
  const openModule = (m: Module) => {
    const tabs = m.tabs.filter((t) => allowed(t.key));
    const remembered = tabs.find((t) => t.key === last[m.id]);
    const target = remembered || tabs[0];
    if (target) go(target.key);
  };
  // The full Buildsasa AI page; the docked panel stays for quick questions.
  const openAi = () => go("buildflex-ai");

  const lock = (k: View) => starter && BUSINESS_VIEWS.includes(k) ? <Lock className="ws-chev" aria-label="Business plan" /> : null;

  const locked1 = (m: Module) => starter && m.tabs.filter((t) => allowed(t.key)).every((t) => BUSINESS_VIEWS.includes(t.key));

  return (
    <>
      <div
        onClick={onClose}
        className={`fixed inset-0 bg-black/60 z-40 lg:hidden transition-opacity ${open ? "opacity-100" : "opacity-0 pointer-events-none"}`}
      />
      <aside
        aria-label="Workspace navigation"
        className={`ws-sidebar ${collapsed ? "ws-collapsed" : ""} fixed lg:static z-50 shrink-0 transition-[transform,width] duration-200 ${open ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}
      >
        <div className="ws-sidebar-top relative">
          <button type="button" className="ws-switcher" onClick={() => setMenu(menu === "workspace" ? null : "workspace")} aria-haspopup="menu" aria-expanded={menu === "workspace"}>
            <img src="/Buildsasa.png" alt="" />
            <span className="truncate">Buildsasa</span>
            <ChevronDown className="w-3.5 h-3.5" style={{ color: "var(--ws-muted)" }} aria-hidden />
          </button>
          {onToggleCollapsed && (
            <button type="button" className="ws-icon-btn ws-ghost ws-collapse-btn hidden lg:flex" style={{ width: 32, height: 32 }} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={collapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={onToggleCollapsed}>
              {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
            </button>
          )}
          <button type="button" className="ws-icon-btn ws-ghost ws-hide-collapsed lg:hidden" style={{ width: 32, height: 32 }} aria-label="Search" onClick={() => { onClose(); window.dispatchEvent(new Event("buildsasa:focus-search")); }}><Search /></button>
          <button type="button" className="ws-icon-btn ws-ghost ws-hide-collapsed" style={{ width: 32, height: 32 }} aria-label="New chat with Buildsasa AI" title="New chat" onClick={() => { onClose(); window.dispatchEvent(new Event("buildsasa:open-new")); }}><SquarePen /></button>
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
            <button type="button" className="ws-row" onClick={openAi} aria-label="Ask Buildsasa AI" title="Ask Buildsasa AI" aria-current={view === "buildflex-ai" ? "page" : undefined} style={{ marginBottom: 6, color: "#FF8A45" }}>
              <Sparkles aria-hidden style={{ color: "#FF6B1A" }} />
              <span className="ws-row-label">Ask Buildsasa AI</span>
            </button>
            <button type="button" className="ws-row" onClick={() => window.dispatchEvent(new Event("buildsasa:design"))} aria-label="AI Design" title="AI Design: 2D plans, 3D renders, facades and interiors" style={{ marginBottom: 6 }}>
              <Box aria-hidden style={{ color: "#FF6B1A" }} />
              <span className="ws-row-label">AI Design</span>
            </button>
            {allowed("floor-plan" as View) && (
              <button type="button" className="ws-row" onClick={() => go("floor-plan" as View)} aria-label="Floor plans" title="Floor plans: describe a house and the AI draws a plan you can edit" aria-current={view === "floor-plan" ? "page" : undefined} style={{ marginBottom: 6 }}>
                <LayoutGrid aria-hidden style={{ color: "#FF6B1A" }} />
                <span className="ws-row-label">Floor plans</span>
              </button>
            )}
            {MODULES.map((m) => {
              if (!m.tabs.some((t) => allowed(t.key))) return null;
              const on = active?.id === m.id;
              return (
                <div key={m.id}>
                  <button type="button" className="ws-row" aria-current={on ? "page" : undefined} onClick={() => openModule(m)} aria-label={m.label} title={collapsed ? `${m.label}: ${m.hint}` : m.hint}>
                    <m.icon aria-hidden />
                    <span className="ws-row-label">{m.label}</span>
                    {locked1(m) && <Lock className="ws-chev" aria-label="Business plan" />}
                  </button>
                  {/* The project last opened stays one click away under Projects. */}
                  {m.id === "projects" && current && !collapsed && (
                    <div className="ws-subtree">
                      <button type="button" className="ws-row" aria-current={view === "project-detail" ? "page" : undefined} onClick={() => { onOpenProject?.(current.id); onClose(); }} aria-label={current.name} title={current.name}>
                        <span className="ws-dot" style={{ color: TONE_DOT[projectTone(current.status)] }} aria-hidden />
                        <span className="ws-row-label">{current.name}</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </nav>

        {ROLE_TESTING && <div className="ws-viewing ws-hide-collapsed relative">
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
        </div>}
        <div className="relative">
          {menu === "user" && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setMenu(null)} />
              <div className="ws-menu" role="menu" style={collapsed ? { left: 8, bottom: 52, width: 240 } : { left: 10, right: 10, bottom: 52 }}>
                <button role="menuitem" className="ws-menu-item" onClick={() => openSettings()}><Settings /> Settings</button>
                {allowed("billing") && <button role="menuitem" className="ws-menu-item" onClick={() => { setMenu(null); go("billing"); }}><CreditCard /> Billing &amp; plan</button>}
                <button role="menuitem" className="ws-menu-item" onClick={() => setCurrency(currency === "KES" ? "USD" : "KES")}><Coins /> Amounts in {currency} <span style={{ marginLeft: "auto", color: "var(--ws-muted)", fontSize: 12 }}>switch to {currency === "KES" ? "USD" : "KES"}</span></button>
                <button role="menuitem" className="ws-menu-item" onClick={() => { setMenu(null); window.dispatchEvent(new Event("buildsasa:toggle-theme")); }}><SunMoon /> Light / dark mode</button>
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


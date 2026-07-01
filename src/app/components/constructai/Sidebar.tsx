import { LayoutDashboard, CalendarDays, FolderKanban, FileText, BarChart3, Users, Settings, LifeBuoy, Smartphone, X, FileStack, ListChecks, ClipboardList, CheckCircle, Handshake, Mail, Bell, Eye, ClipboardCheck, MessageSquare, Briefcase, UsersRound, FolderOpen, Megaphone, Shield, ChevronDown, ChevronRight, Gavel, Receipt, ShieldAlert, Truck, Clock, FileDigit, CreditCard, LogOut, Boxes } from "lucide-react";
import { useState, useEffect } from "react";
import type { Role } from "./roles";
import { ROLES, ROLE_COLORS } from "./roles";
import { isViewVisible } from "../../config/features";
import apiClient, { type UserProfile } from "../../services/api";

export type View =
  | "login"
  | "dashboard"
  | "projects"
  | "change-order"
  | "change-orders"
  | "plans"
  | "tasks"
  | "schedule"
  | "documents"
  | "daily-log"
  | "punch-list"
  | "commitments"
  | "mobile-create"
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
  | "company-docs"
  | "role-manager"
  | "bidding"
  | "invoicing"
  | "inspections"
  | "safety-incidents"
  | "equipment"
  | "attendance"
  | "buildflex-ai"
  | "forms"
  | "checklists"
  | "billing";

type NavItem = { key: View; label: string; icon: any };

type NavGroup = { label: string; items: NavItem[] };

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
      { key: "inbox", label: "Inbox", icon: Mail },
      { key: "announcements", label: "Announcements", icon: Megaphone },
    ],
  },
  {
    label: "Project Work",
    items: [
      { key: "projects", label: "Projects", icon: FolderKanban },
      { key: "checklists", label: "Checklists", icon: ClipboardList },
      { key: "tasks", label: "Tasks & Trades", icon: ListChecks },
      { key: "schedule", label: "Schedule", icon: CalendarDays },
      { key: "daily-log", label: "Daily Log", icon: ClipboardList },
      { key: "change-orders", label: "Change Orders", icon: FileText },
      { key: "plans", label: "Plans & Drawings", icon: FileStack },
      { key: "punch-list", label: "Punch List", icon: CheckCircle },
      { key: "observations", label: "Observations", icon: Eye },
      { key: "action-plans", label: "Action Plans", icon: ClipboardCheck },
    ],
  },
  {
    label: "Commitments & Money",
    items: [
      { key: "bidding", label: "Bidding", icon: Gavel },
      { key: "commitments", label: "Commitments", icon: Handshake },
      { key: "financials", label: "Financials", icon: BarChart3 },
      { key: "invoicing", label: "Invoicing", icon: Receipt },
      { key: "billing", label: "Billing & Plan", icon: CreditCard },
    ],
  },
  {
    label: "Quality & Safety",
    items: [
      { key: "inspections", label: "Inspections", icon: ClipboardCheck },
      { key: "safety-incidents", label: "Safety Incidents", icon: ShieldAlert },
      { key: "forms", label: "Digitized Forms", icon: FileDigit },
    ],
  },
  {
    label: "Resources",
    items: [
      { key: "equipment", label: "Inventory", icon: Boxes },
    ],
  },
  {
    label: "Reports",
    items: [
      { key: "reports", label: "Reports", icon: BarChart3 },
    ],
  },
  {
    label: "Documents & Comms",
    items: [
      { key: "documents", label: "Project Documents", icon: FileText },
      { key: "company-docs", label: "Company Documents", icon: FolderOpen },
      { key: "correspondence", label: "Correspondence", icon: MessageSquare },
      { key: "coordination", label: "Coordination Issues", icon: Briefcase },
    ],
  },
  {
    label: "People",
    items: [
      { key: "directory", label: "Directory", icon: Users },
      { key: "crews", label: "Crews", icon: UsersRound },
      { key: "team", label: "Team", icon: Users },
      { key: "attendance", label: "Attendance", icon: Clock },
      { key: "role-manager", label: "Role Manager", icon: Shield },
    ],
  },
];

export function Sidebar({
  view,
  setView,
  open,
  onClose,
  role,
  locked = false,
}: {
  view: View;
  setView: (v: View) => void;
  open: boolean;
  onClose: () => void;
  role: Role;
  locked?: boolean;
}) {
  const perms = ROLES[role];
  const go = (v: View) => {
    setView(v);
    onClose();
  };
  const allowed = (v: View) => perms.views.includes(v) && isViewVisible(v);

  // Real logged-in user for the profile card (name, role, avatar). Refreshes
  // when the profile is edited in Settings.
  const [me, setMe] = useState<UserProfile | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
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
  const displayName = me?.name || "Your profile";
  const displayRole = me?.role || role;
  const initials = (me?.name || "U").trim().split(/\s+/).map((s) => s[0]).slice(0, 2).join("").toUpperCase() || "U";

  // Track which sections are expanded; all sections open by default
  const activeGroup = NAV_GROUPS.find((g) => g.items.some((n) => n.key === view))?.label ?? null;
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem("constructai-sidebar-expanded");
      if (saved) return new Set(JSON.parse(saved));
    } catch { /* noop */ }
    return new Set(NAV_GROUPS.map((g) => g.label));
  });

  useEffect(() => {
    try {
      localStorage.setItem("constructai-sidebar-expanded", JSON.stringify(Array.from(expanded)));
    } catch { /* noop */ }
  }, [expanded]);

  // Auto-expand the section containing the current view whenever it changes
  useEffect(() => {
    if (activeGroup) {
      setExpanded((prev) => {
        if (prev.has(activeGroup)) return prev;
        const next = new Set(prev);
        next.add(activeGroup);
        return next;
      });
    }
  }, [view, activeGroup]);

  const toggleGroup = (label: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  return (
    <>
      <div
        onClick={onClose}
        className={`fixed inset-0 bg-black/60 z-40 lg:hidden transition-opacity ${open ? "opacity-100" : "opacity-0 pointer-events-none"}`}
      />
      <aside
        className={`fixed lg:static z-50 w-[260px] lg:w-[240px] shrink-0 h-screen border-r border-[#222A35] bg-[#0A0E14] flex flex-col transition-transform duration-200 ${open ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}
      >
        <div className="px-5 py-5 border-b border-[#222A35] flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg overflow-hidden flex items-center justify-center">
            <img src="/Buildsasa.png" alt="Buildsasa" className="w-full h-full object-cover" />
          </div>
          <div className="flex-1">
            <div className="text-[14px] text-white tracking-tight font-display">Buildsasa</div>
            <div className="text-[10px] text-[#5B6675] uppercase tracking-wider">Pro Workspace</div>
          </div>
          <button onClick={onClose} className="lg:hidden text-[#8A95A5] hover:text-white"><X className="w-4 h-4" /></button>
        </div>

        <div className="px-3 pt-3">
          <div className="px-2.5 py-2 rounded-md bg-[#161C24] border border-[#222A35] flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: ROLE_COLORS[role] }} />
            <div className="min-w-0 flex-1">
              <div className="text-[9px] text-[#5B6675] uppercase tracking-wider">Viewing as</div>
              <div className="text-[12px] text-white truncate">{role}</div>
            </div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {locked && (
            <button
              onClick={() => go("billing")}
              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13px] bg-[#FF6B1A]/15 text-[#FF6B1A] border border-[#FF6B1A]/30 mb-3 hover:bg-[#FF6B1A]/25 transition"
            >
              <CreditCard className="w-4 h-4" />
              <span className="flex-1 text-left">Billing &amp; Plan</span>
            </button>
          )}
          <div className={locked ? "blur-sm select-none pointer-events-none opacity-70" : ""} aria-hidden={locked || undefined}>
          {NAV_GROUPS.map((group) => {
            const visibleItems = group.items.filter((n) => allowed(n.key));
            if (visibleItems.length === 0) return null;
            const isExpanded = expanded.has(group.label);
            return (
              <div key={group.label} className="mb-2">
                <button
                  onClick={() => toggleGroup(group.label)}
                  className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[10px] text-[#5B6675] uppercase tracking-wider hover:text-[#8A95A5] hover:bg-[#11161D]/50 transition"
                >
                  {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                  <span className="flex-1 text-left">{group.label}</span>
                  <span className="text-[9px] px-1 py-0.5 rounded-full bg-[#222A35] text-[#5B6675]">{visibleItems.length}</span>
                </button>
                <div
                  className={`overflow-hidden transition-all duration-200 ease-in-out ${
                    isExpanded ? "max-h-[500px] opacity-100 mt-1" : "max-h-0 opacity-0"
                  }`}
                >
                  <div className="space-y-0.5">
                    {visibleItems.map((n) => {
                      const active = view === n.key;
                      return (
                        <button
                          key={n.key}
                          onClick={() => go(n.key)}
                          className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13px] transition ${
                            active ? "bg-[#161C24] text-white" : "text-[#8A95A5] hover:text-white hover:bg-[#11161D]"
                          }`}
                        >
                          <n.icon className="w-4 h-4" />
                          <span className="flex-1 text-left">{n.label}</span>
                          {active && <span className="ml-auto w-1 h-1 rounded-full bg-[#FF6B1A]" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
          </div>
        </nav>

        <div className="px-3 py-3 border-t border-[#222A35] relative">
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute z-20 left-3 right-3 bottom-[68px] rounded-lg border border-[#222A35] bg-[#11161D] shadow-2xl py-1">
                <button onClick={() => { setMenuOpen(false); onClose(); window.dispatchEvent(new Event("buildflex:open-settings")); }} className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-[#8A95A5] hover:text-white hover:bg-[#161C24]"><Settings className="w-4 h-4" /> Settings</button>
                <button onClick={() => { setMenuOpen(false); window.open("mailto:support@buildsasa.com?subject=Support%20Request", "_blank"); }} className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-[#8A95A5] hover:text-white hover:bg-[#161C24]"><LifeBuoy className="w-4 h-4" /> Help & Support</button>
                <div className="my-1 border-t border-[#222A35]" />
                <button onClick={signOut} className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-[#EF4444] hover:bg-[#EF4444]/10"><LogOut className="w-4 h-4" /> Sign out</button>
              </div>
            </>
          )}
          <button onClick={() => setMenuOpen((v) => !v)} title="Profile & settings" className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md bg-[#11161D] hover:bg-[#161C24] transition-colors">
            {me?.avatar
              ? <img src={me.avatar} alt="" className="w-7 h-7 rounded-full object-cover" />
              : <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#FF6B1A] to-[#F5A623] flex items-center justify-center text-white text-[11px]">{initials}</div>}
            <div className="min-w-0 flex-1 text-left">
              <div className="text-[12px] text-white truncate">{displayName}</div>
              <div className="text-[10px] text-[#5B6675] truncate">{displayRole}</div>
            </div>
            <ChevronDown className={`w-4 h-4 text-[#5B6675] transition-transform ${menuOpen ? "rotate-180" : ""}`} />
          </button>
        </div>
      </aside>
    </>
  );
}

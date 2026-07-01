import { useState, useRef, useEffect } from "react";
import { Search, Bell, Plus, Menu, ChevronDown, Check, Eye, Sun, Moon, Coins, Sparkles } from "lucide-react";
import { toast } from "sonner";
import type { Role } from "./roles";
import { ROLES, ROLE_COLORS } from "./roles";

// Role is normally fixed by how the user logged in. The interactive "View as"
// switcher is a testing aid only — enable it with localStorage bf-role-testing=1.
const ROLE_TESTING = (() => { try { return localStorage.getItem("bf-role-testing") === "1"; } catch { return false; } })();
import { useCurrency } from "./CurrencyContext";
import { formatCurrency } from "./currency";

const $toKES = (dollars: number) => Math.round(dollars * 130);

const SEARCH_INDEX = [
  { type: "Project", label: "Harborfront Tower", target: "projects" as const },
  { type: "Project", label: "Midtown Medical Center", target: "projects" as const },
  { type: "CO", label: "CO-1258 · VAV boxes east wing", target: "change-order" as const, coId: "CO-1258" },
  { type: "CO", label: "CO-1284 · Curtain wall reinforcement", target: "change-order" as const, coId: "CO-1284" },
  { type: "People", label: "Sarah Patel · Field Supervisor", target: "team" as const },
  { type: "People", label: "Jane Cho · Project Executive", target: "team" as const },
  { type: "Drawing", label: "M-401 Rev 4 — Mechanical", target: "plans" as const },
  { type: "Report", label: "Approval bottlenecks Q2", target: "reports" as const },
];

const NOTIFICATIONS = [
  { t: "Owner approved CO-1252", s: "2m ago", c: "#22C55E", target: "change-order" as const, coId: "CO-1252" },
  { t: "New comment on CO-1258", s: "18m ago", c: "#3B82F6", target: "change-order" as const, coId: "CO-1258" },
  { t: "Drawing M-401 Rev 4 published", s: "1h ago", c: "#FF6B1A", target: "plans" as const },
];

export function Topbar({
  title,
  subtitle,
  onMenu,
  onNewOrder,
  role,
  setRole,
  onNavigate,
  onOpenChangeOrder,
  onOpenAi,
  theme,
  setTheme,
}: {
  title: string;
  subtitle?: string;
  onMenu: () => void;
  onNewOrder: () => void;
  role: Role;
  setRole: (r: Role) => void;
  onNavigate: (v: any) => void;
  onOpenChangeOrder: (id: string) => void;
  onOpenAi?: () => void;
  theme: "dark" | "light";
  setTheme: (t: "dark" | "light") => void;
}) {
  const [q, setQ] = useState("");
  const [showResults, setShowResults] = useState(false);
  const [showRoles, setShowRoles] = useState(false);
  const [showNotifs, setShowNotifs] = useState(false);
  const [showCurrency, setShowCurrency] = useState(false);
  const { currency, setCurrency, currencies } = useCurrency();

  const roleRef = useRef<HTMLDivElement>(null);
  const currencyRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (showRoles && roleRef.current && !roleRef.current.contains(target)) setShowRoles(false);
      if (showCurrency && currencyRef.current && !currencyRef.current.contains(target)) setShowCurrency(false);
      if (showNotifs && notifRef.current && !notifRef.current.contains(target)) setShowNotifs(false);
      if (showResults && searchRef.current && !searchRef.current.contains(target)) setShowResults(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showRoles, showCurrency, showNotifs, showResults]);

  const results = q
    ? SEARCH_INDEX.filter((r) => r.label.toLowerCase().includes(q.toLowerCase()) || r.type.toLowerCase().includes(q.toLowerCase()))
    : SEARCH_INDEX.slice(0, 4);

  const canCreate = ROLES[role].createCO;

  return (
    <div className={`min-h-[64px] shrink-0 border-b flex flex-col sm:flex-row sm:items-center sm:justify-between px-4 sm:px-7 gap-3 sm:gap-4 py-3 sm:py-0 relative ${theme === "light" ? "bg-white border-[#E2E8F0]" : "bg-[#0A0E14] border-[#222A35]"}`}>
      <div className="flex items-center gap-3 min-w-0 w-full sm:w-auto">
        <button onClick={onMenu} className={`lg:hidden h-9 w-9 rounded-md border flex items-center justify-center shrink-0 ${theme === "light" ? "bg-[#F1F5F9] border-[#E2E8F0] text-[#1A1D23]" : "bg-[#11161D] border-[#222A35] text-white"}`}>
          <Menu className="w-4 h-4" />
        </button>
        <div className="min-w-0">
          <div className={`hidden sm:flex items-center gap-2 text-[12px] ${theme === "light" ? "text-[#64748B]" : "text-[#5B6675]"}`}>
            <span>Workspace</span><span>/</span><span className={theme === "light" ? "text-[#475569]" : "text-[#8A95A5]"}>{title}</span>
          </div>
          <div className={`text-[15px] sm:text-[18px] tracking-tight truncate font-display ${theme === "light" ? "text-[#1A1D23]" : "text-white"}`}>{subtitle || title}</div>
        </div>
      </div>

      <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 sm:gap-2.5 w-full sm:w-auto justify-start sm:justify-end">
        {/* Search */}
        <div ref={searchRef} className="relative hidden lg:block">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#5B6675]" />
          <input
            value={q}
            onChange={(e) => { setQ(e.target.value); setShowResults(true); }}
            onFocus={() => setShowResults(true)}
            placeholder="Search projects, orders, people, drawings…"
            className={`w-[220px] lg:w-[340px] h-9 rounded-md pl-8 pr-3 text-[12px] focus:outline-none focus:border-[#FF6B1A] border ${theme === "light" ? "bg-white border-[#E2E8F0] text-[#1A1D23] placeholder:text-[#94A3B8]" : "bg-[#11161D] border-[#222A35] text-white placeholder:text-[#5B6675]"}`}
          />
          {showResults && (
            <div className={`absolute top-11 left-0 right-0 rounded-md shadow-2xl z-50 overflow-hidden border ${theme === "light" ? "bg-white border-[#E2E8F0]" : "bg-[#11161D] border-[#222A35]"}`}>
              <div className={`px-3 py-2 text-[10px] uppercase tracking-wider border-b ${theme === "light" ? "text-[#64748B] border-[#E2E8F0]" : "text-[#5B6675] border-[#222A35]"}`}>{results.length} results</div>
              <div className="max-h-[340px] overflow-y-auto">
                {results.map((r) => (
                  <button
                    key={r.label}
                    onMouseDown={() => {
                      if (r.target === "change-order" && r.coId) {
                        onOpenChangeOrder(r.coId);
                      } else {
                        onNavigate(r.target);
                      }
                      setQ("");
                      setShowResults(false);
                      toast(`Opening: ${r.label}`);
                    }}
                    className={`w-full text-left px-3 py-2.5 flex items-center gap-2.5 border-b last:border-0 ${theme === "light" ? "hover:bg-[#F1F5F9] border-[#E2E8F0]/40" : "hover:bg-[#161C24] border-[#222A35]/40"}`}
                  >
                    <span className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded ${theme === "light" ? "bg-[#E2E8F0] text-[#64748B]" : "bg-[#222A35] text-[#8A95A5]"}`}>{r.type}</span>
                    <span className={`text-[12px] truncate ${theme === "light" ? "text-[#1A1D23]" : "text-white"}`}>{r.label}</span>
                  </button>
                ))}
                {results.length === 0 && <div className={`px-3 py-6 text-[12px] text-center ${theme === "light" ? "text-[#64748B]" : "text-[#5B6675]"}`}>No matches</div>}
              </div>
            </div>
          )}
        </div>

        <button onClick={() => toast("Open ⌘K command palette")} className={`lg:hidden h-9 w-9 rounded-md border flex items-center justify-center ${theme === "light" ? "bg-white border-[#E2E8F0] text-[#64748B] hover:text-[#1A1D23]" : "bg-[#11161D] border-[#222A35] text-[#8A95A5] hover:text-white"}`}>
          <Search className="w-4 h-4" />
        </button>

        {/* Role indicator — static badge in production; interactive switcher only in role-testing mode */}
        <div ref={roleRef} className="relative">
          {!ROLE_TESTING ? (
            <div className={`h-9 px-2.5 rounded-md border flex items-center gap-2 text-[12px] whitespace-nowrap ${theme === "light" ? "bg-white border-[#E2E8F0] text-[#1A1D23]" : "bg-[#11161D] border-[#222A35] text-white"}`}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: ROLE_COLORS[role] }} />
              <span className="hidden sm:inline">{role}</span>
            </div>
          ) : (
          <button
            onClick={() => setShowRoles((s) => !s)}
            className={`h-9 px-2.5 rounded-md border flex items-center gap-2 text-[12px] whitespace-nowrap ${theme === "light" ? "bg-white border-[#E2E8F0] text-[#1A1D23] hover:border-[#CBD5E1]" : "bg-[#11161D] border-[#222A35] text-white hover:border-[#2C3744]"}`}
          >
            <Eye className="w-3.5 h-3.5 text-[#8A95A5]" />
            <span className="hidden sm:inline">View as</span>
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: ROLE_COLORS[role] }} />
              <span className="hidden sm:inline">{role}</span>
            </span>
            <ChevronDown className="w-3 h-3 text-[#5B6675]" />
          </button>
          )}
          {ROLE_TESTING && showRoles && (
            <div className={`absolute right-0 top-11 w-[260px] rounded-md shadow-2xl z-50 overflow-hidden border ${theme === "light" ? "bg-white border-[#E2E8F0]" : "bg-[#11161D] border-[#222A35]"}`}>
              <div className={`px-3 py-2 text-[10px] uppercase tracking-wider border-b ${theme === "light" ? "text-[#64748B] border-[#E2E8F0]" : "text-[#5B6675] border-[#222A35]"}`}>Preview as role</div>
              {(Object.keys(ROLES) as Role[]).map((r) => (
                <button
                  key={r}
                  onClick={() => { setRole(r); setShowRoles(false); toast.success(`Now viewing as ${r}`); }}
                  className={`w-full text-left px-3 py-2.5 flex items-center gap-2.5 border-b last:border-0 ${theme === "light" ? "hover:bg-[#F1F5F9] border-[#E2E8F0]/40" : "hover:bg-[#161C24] border-[#222A35]/40"}`}
                >
                  <span className="w-2 h-2 rounded-full" style={{ background: ROLE_COLORS[r] }} />
                  <div className="flex-1">
                    <div className={`text-[12px] ${theme === "light" ? "text-[#1A1D23]" : "text-white"}`}>{r}</div>
                    <div className={`text-[10px] ${theme === "light" ? "text-[#64748B]" : "text-[#5B6675]"}`}>
                      Approves to {ROLES[r].approveLimit === Infinity ? "∞" : formatCurrency($toKES(ROLES[r].approveLimit), currency)} · {ROLES[r].views.length} views
                    </div>
                  </div>
                  {role === r && <span className="w-5 h-5 rounded-full bg-[#FF6B1A] flex items-center justify-center"><Check className="w-3.5 h-3.5 text-white" /></span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Currency selector */}
        <div ref={currencyRef} className="relative">
          <button
            onClick={() => setShowCurrency((s) => !s)}
            className={`h-9 px-2.5 rounded-md border flex items-center gap-1.5 text-[12px] whitespace-nowrap ${theme === "light" ? "bg-white border-[#E2E8F0] text-[#1A1D23] hover:border-[#CBD5E1]" : "bg-[#11161D] border-[#222A35] text-white hover:border-[#2C3744]"}`}
            title="Change currency"
          >
            <Coins className="w-3.5 h-3.5 text-[#8A95A5]" />
            <span className="hidden sm:inline">{currencies[currency].symbol}</span>
            <span className="text-[#5B6675]">{currency}</span>
            <ChevronDown className="w-3 h-3 text-[#5B6675]" />
          </button>
          {showCurrency && (
            <div className={`absolute right-0 top-11 w-[200px] rounded-md shadow-2xl z-50 overflow-hidden border ${theme === "light" ? "bg-white border-[#E2E8F0]" : "bg-[#11161D] border-[#222A35]"}`}>
              <div className={`px-3 py-2 text-[10px] uppercase tracking-wider border-b ${theme === "light" ? "text-[#64748B] border-[#E2E8F0]" : "text-[#5B6675] border-[#222A35]"}`}>Select currency</div>
              {(Object.keys(currencies) as Array<keyof typeof currencies>).map((c) => (
                <button
                  key={c}
                  onClick={() => { setCurrency(c); setShowCurrency(false); toast.success(`Currency set to ${currencies[c].name}`); }}
                  className={`w-full text-left px-3 py-2.5 flex items-center gap-2.5 border-b last:border-0 ${theme === "light" ? "hover:bg-[#F1F5F9] border-[#E2E8F0]/40" : "hover:bg-[#161C24] border-[#222A35]/40"}`}
                >
                  <span className={`text-[14px] font-medium ${theme === "light" ? "text-[#1A1D23]" : "text-white"}`}>{currencies[c].symbol}</span>
                  <div className="flex-1">
                    <div className={`text-[12px] ${theme === "light" ? "text-[#1A1D23]" : "text-white"}`}>{c}</div>
                    <div className={`text-[10px] ${theme === "light" ? "text-[#64748B]" : "text-[#5B6675]"}`}>{currencies[c].name}</div>
                  </div>
                  {currency === c && <span className="w-5 h-5 rounded-full bg-[#FF6B1A] flex items-center justify-center"><Check className="w-3.5 h-3.5 text-white" /></span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Buildflex AI */}
        {onOpenAi && ROLES[role].useAI && (
          <button
            onClick={onOpenAi}
            title="Ask Buildsasa AI"
            className={`h-9 w-9 rounded-md border flex items-center justify-center transition-colors ${theme === "light" ? "bg-white border-[#E2E8F0] text-[#FF6B1A] hover:border-[#FF6B1A]/60" : "bg-[#11161D] border-[#222A35] text-[#FF6B1A] hover:border-[#FF6B1A]/60"}`}
          >
            <Sparkles className="w-4 h-4" />
          </button>
        )}

        {/* Theme toggle */}
        <button
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          className={`h-9 w-9 rounded-md border flex items-center justify-center ${theme === "light" ? "bg-white border-[#E2E8F0] text-[#64748B] hover:text-[#1A1D23]" : "bg-[#11161D] border-[#222A35] text-[#8A95A5] hover:text-white"}`}
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>

        {/* Notifications */}
        <div ref={notifRef} className="relative">
          <button
            onClick={() => setShowNotifs((s) => !s)}
            className={`h-9 w-9 rounded-md border flex items-center justify-center relative ${theme === "light" ? "bg-white border-[#E2E8F0] text-[#64748B] hover:text-[#1A1D23]" : "bg-[#11161D] border-[#222A35] text-[#8A95A5] hover:text-white"}`}
          >
            <Bell className="w-4 h-4" />
            <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-[#FF6B1A]" />
          </button>
          {showNotifs && (
            <div className={`absolute right-0 top-11 w-[300px] rounded-md shadow-2xl z-50 border ${theme === "light" ? "bg-white border-[#E2E8F0]" : "bg-[#11161D] border-[#222A35]"}`}>
              <div className={`px-3 py-2 text-[10px] uppercase tracking-wider border-b ${theme === "light" ? "text-[#64748B] border-[#E2E8F0]" : "text-[#5B6675] border-[#222A35]"}`}>3 New</div>
              {NOTIFICATIONS.map((n, i) => (
                <button
                  key={i}
                  onClick={() => {
                    setShowNotifs(false);
                    if (n.target === "change-order" && n.coId) {
                      onOpenChangeOrder(n.coId);
                    } else {
                      onNavigate(n.target);
                    }
                    toast(n.t);
                  }}
                  className={`w-full text-left px-3 py-2.5 border-b last:border-0 flex items-start gap-2.5 ${theme === "light" ? "hover:bg-[#F1F5F9] border-[#E2E8F0]/40" : "hover:bg-[#161C24] border-[#222A35]/40"}`}
                >
                  <span className="w-1.5 h-1.5 rounded-full mt-1.5" style={{ background: n.c }} />
                  <div className="flex-1">
                    <div className={`text-[12px] ${theme === "light" ? "text-[#1A1D23]" : "text-white"}`}>{n.t}</div>
                    <div className={`text-[10px] ${theme === "light" ? "text-[#64748B]" : "text-[#5B6675]"}`}>{n.s}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          onClick={canCreate ? onNewOrder : () => toast.error(`${role} cannot create change orders`)}
          className={`h-9 px-2.5 sm:px-3 rounded-md text-[12px] flex items-center gap-1.5 whitespace-nowrap ${
            canCreate
              ? "bg-[#FF6B1A] hover:bg-[#FF7E33] text-white shadow-[0_4px_14px_rgba(255,107,26,0.35)]"
              : "bg-[#222A35] text-[#5B6675] cursor-not-allowed"
          }`}
        >
          <Plus className="w-3.5 h-3.5" />
          <span className="hidden lg:inline">New Change Order</span>
          <span className="hidden sm:inline lg:hidden">New CO</span>
          <span className="sm:hidden">New</span>
        </button>
      </div>
    </div>
  );
}

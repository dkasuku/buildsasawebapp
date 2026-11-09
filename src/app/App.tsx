import { useState, useEffect, useLayoutEffect, useCallback } from "react";
import { flushSync } from "react-dom";
import { Toaster, toast } from "sonner";
import { Sidebar, type View } from "./components/constructai/Sidebar";
import { Topbar } from "./components/constructai/Topbar";
import { Login } from "./components/constructai/Login";
import { ResetPassword } from "./components/constructai/ResetPassword";
import { PublicFormFill } from "./components/constructai/PublicFormFill";
import { PublicBidSubmit } from "./components/constructai/PublicBidSubmit";
import { PublicQuoteView } from "./components/constructai/PublicQuoteView";
import { PublicUnitView } from "./components/constructai/PublicUnitView";
import { BuyCreditsModal } from "./components/constructai/BuyCreditsModal";
import { PublicPortalView } from "./components/constructai/PublicPortalView";
import { ClientApp } from "./components/constructai/client/ClientApp";
import { isFirstSignIn, markWelcomed, storedUser } from "./components/constructai/Welcome";
import { BUSINESS_VIEWS, setPlanTier } from "./components/constructai/planTier";
import { PlanUpgrade } from "./components/constructai/PlanUpgrade";
import { ErrorBoundary } from "./components/constructai/ErrorBoundary";
import { Dashboard } from "./components/constructai/Dashboard";
import { Projects } from "./components/constructai/Projects";
import { ProjectDetail } from "./components/constructai/ProjectDetail";
import { FieldView } from "./components/constructai/FieldView";
import { Reports } from "./components/constructai/Reports";
import { Plans } from "./components/constructai/Plans";
import { Schedule } from "./components/constructai/Schedule";
import Financials from "./components/constructai/Financials";
import { Documents } from "./components/constructai/Documents";
import { DailyLog } from "./components/constructai/DailyLog";
import PunchListPro from "./components/constructai/PunchListPro";
import ChangeOrders from "./components/constructai/ChangeOrders";
import Billing from "./components/constructai/Billing";
import TeamMembers from "./components/constructai/TeamMembers";
import api from "./services/api";
import { Inbox } from "./components/constructai/Inbox";
import { Announcements } from "./components/constructai/Announcements";
import { RoleManager } from "./components/constructai/RoleManager";
import Invoicing from "./components/constructai/Invoicing";
import Quotes from "./components/constructai/Quotes";
import Inspections from "./components/constructai/Inspections";
import SafetyIncidents from "./components/constructai/SafetyIncidents";
import Inventory from "./components/constructai/Inventory";
import Attendance from "./components/constructai/Attendance";
import { AiWorkspace } from "./components/constructai/AiWorkspace";
import { useAiSession } from "./components/constructai/aiSession";
import { ChecklistsHub } from "./components/constructai/ChecklistsHub";
import Observations from "./components/constructai/Observations";
import Coordination from "./components/constructai/Coordination";
import CorrespondenceModule from "./components/constructai/Correspondence";
import Crews from "./components/constructai/Crews";
import Directory from "./components/constructai/Directory";
import CompanyDocs from "./components/constructai/CompanyDocs";
import Subcontractors from "./components/constructai/Subcontractors";
import type { Role } from "./components/constructai/roles";
import { ROLES } from "./components/constructai/roles";
import { CurrencyProvider } from "./components/constructai/CurrencyContext";
import { visibleViewsFor } from "./config/features";
import { ModuleTabs } from "./components/constructai/ModuleTabs";
import { AskBar } from "./components/constructai/AskBar";
import { askFor, moduleOf } from "./components/constructai/modules";
import { ProfileSettings } from "./components/constructai/ProfileSettings";
import { CreditCard } from "lucide-react";
import { AiAssistantPanel, type AiFormDraft } from "./components/constructai/AiAssistantPanel";
import ShemmySupport from "./components/constructai/ShemmySupport";

const TITLES: Record<Exclude<View, "login">, { title: string; subtitle: string }> = {
  dashboard: { title: "Dashboard", subtitle: "Executive overview" },
  projects: { title: "Projects", subtitle: "Your sites and jobs" },
  "project-detail": { title: "Project", subtitle: "Contract, drawings, BOQ, variations, certificates, site & costs — in one place" },
  "change-orders": { title: "Variations", subtitle: "Extra work, its cost and the client's approval" },
  billing: { title: "Billing & plan", subtitle: "Subscription & payments" },
  plans: { title: "Drawings", subtitle: "Plans and their latest revisions" },
  tasks: { title: "Checklists", subtitle: "Checklist assignments and progress by trade" },
  schedule: { title: "Schedule", subtitle: "Project timeline — Gantt, dates & milestones" },
  documents: { title: "Unfiled documents", subtitle: "Documents with no project — file them into one" },
  "daily-log": { title: "Daily log", subtitle: "What happened on site each day, with photos" },
  "punch-list": { title: "Snags", subtitle: "What needs fixing before handover" },
  commitments: { title: "Commitments", subtitle: "Subcontracts, POs, obligations" },
  reports: { title: "Reports", subtitle: "Financial & operational analytics" },
  financials: { title: "Budget & spending", subtitle: "What each site was budgeted, and what it has cost" },
  team: { title: "Team", subtitle: "Who works with you, and what they can see" },
  "field-view": { title: "Field view", subtitle: "Today's work on site" },
  inbox: { title: "Messages", subtitle: "Conversations with your team and clients" },
  announcements: { title: "Announcements", subtitle: "Company-wide broadcasts & notices" },
  observations: { title: "Observations", subtitle: "Quality & safety site observations" },
  "action-plans": { title: "Observations", subtitle: "Site issues and their corrective actions" },
  coordination: { title: "Coordination issues", subtitle: "RFIs, clashes, design questions" },
  correspondence: { title: "Correspondence", subtitle: "Letters, submittals & transmittals" },
  crews: { title: "Crews", subtitle: "Crew rosters & schedules" },
  directory: { title: "Contacts", subtitle: "Suppliers, subcontractors, consultants and clients" },
  subcontractors: { title: "Subcontractors", subtitle: "Subcontractor & supplier database · engagements & payments" },
  "company-docs": { title: "Company documents", subtitle: "NCA, KRA, permits and certificates, with expiry reminders" },
  "role-manager": { title: "Role manager", subtitle: "Configure team roles and permissions" },
  bidding: { title: "Bidding", subtitle: "Subcontractor bids and tendering" },
  jobs: { title: "Jobs board", subtitle: "Work opportunities from Buildsasa, open for bids" },
  quotes: { title: "Quotes", subtitle: "Price jobs, send them for online acceptance, convert wins to projects" },
  invoicing: { title: "Invoices", subtitle: "What clients owe you, and what's overdue" },
  inspections: { title: "Inspections", subtitle: "Site and quality checks" },
  checklists: { title: "Checklists", subtitle: "Checklists for your crews to fill in on site" },
  "safety-incidents": { title: "Safety", subtitle: "Accidents, near misses and what was done" },
  equipment: { title: "Materials & equipment", subtitle: "Stock on site, and plant owned or hired" },
  attendance: { title: "Attendance", subtitle: "Who was on site, and for how long" },
  "buildflex-ai": { title: "Buildsasa AI", subtitle: "Your site secretary" },
};

// Where to land when a page isn't available: Buildsasa AI is home.
const homeView = (allowed: View[]): View =>
  allowed.includes("buildflex-ai") ? "buildflex-ai" : (allowed[0] ?? "buildflex-ai");

export default function App() {
  const [view, setView] = useState<View>(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      // Shared drawing link (/?drawing=ID): remembered across sign-in, opened by Plans.
      const sharedDrawing = params.get("drawing");
      if (sharedDrawing) {
        try { sessionStorage.setItem("pending-drawing", sharedDrawing); } catch { /* noop */ }
        window.history.replaceState({}, "", window.location.pathname);
        if (localStorage.getItem("constructai-token")) return "plans";
      }
      // Google OAuth redirect: /?handoff=… — a single-use code, exchanged for the
      // real session by the effect below. The session token used to arrive in
      // this URL directly, which put it in history and in every log on the way.
      if (params.get("handoff")) return "login";
      // Returning from Paystack checkout (?reference=…): land on Billing so the
      // payment is verified there (Billing reads the query param).
      const payRef = params.get("reference") || params.get("trxref");
      if (payRef && localStorage.getItem("constructai-token")) return "billing";
      // Login is required: start on the login screen unless a session token
      // exists. Signed in, the workspace opens on Buildsasa AI.
      return localStorage.getItem("constructai-token") ? "buildflex-ai" : "login";
    } catch { return "login"; }
  });
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Where the user has been, so every page has a "Back to …" without each
  // screen carrying its own. Pushed on every navigation; popped by goBack.
  const [history, setHistory] = useState<View[]>([]);
  const navigate = useCallback((v: View) => {
    setView((cur) => {
      if (cur !== v && cur !== "login") setHistory((h) => [...h.slice(-19), cur]);
      return v;
    });
  }, []);
  const goBack = useCallback(() => {
    setHistory((h) => {
      const prev = h[h.length - 1];
      if (prev) setView(prev);
      return h.slice(0, -1);
    });
  }, []);
  const [role, setRole] = useState<Role>(() => {
    // Role is determined by the logged-in account (persisted at login/signup).
    try {
      const u = JSON.parse(localStorage.getItem("constructai-user") || "null");
      if (u && u.role && ROLES[u.role as Role]) return u.role as Role;
    } catch { /* noop */ }
    return "Contractor";
  });
  const [theme, setThemeState] = useState<"dark" | "light">(() => {
    try {
      const saved = localStorage.getItem("constructai-theme");
      if (saved === "light" || saved === "dark") return saved;
    } catch { /* noop */ }
    // Light by default; anyone who picked dark keeps it.
    return "light";
  });
  // First sign-in: no popups. An owner or manager is greeted on the AI page,
  // which sets up their first site with them in conversation. Read live (not
  // once at mount) so a sign-up in this same tab still gets it.
  const [firstRunDone, setFirstRunDone] = useState(false);
  const firstRun = !firstRunDone && isFirstSignIn();
  const endFirstRun = () => { markWelcomed(); setFirstRunDone(true); };
  // Invited team members join a workspace that is already set up: nothing to
  // walk through, so their first sign-in is simply recorded.
  useEffect(() => {
    if (firstRun && view !== "login" && storedUser()?.role !== "Client" && (role as string) !== "Client" && !(ROLES[role].isWorkspaceOwner || ROLES[role].manageTeam)) endFirstRun();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstRun, view, role]);
  // Buildsasa AI, docked on the right. On a desktop it stays open by default
  // (people work through it); on a phone it's a sheet opened on demand.
  const [aiPanelOpen, setAiPanelOpenRaw] = useState(() => {
    try { const v = localStorage.getItem("buildsasa-ai-open"); return v ? v === "1" : window.innerWidth >= 1280; } catch { return false; }
  });
  const setAiPanelOpen = (on: boolean) => {
    setAiPanelOpenRaw(on);
    if (window.innerWidth >= 1280) { try { localStorage.setItem("buildsasa-ai-open", on ? "1" : "0"); } catch { /* noop */ } }
  };
  // A prompt to drop into the AI's input (from "Ask AI about…" buttons).
  const [aiPrefill, setAiPrefill] = useState<string | null>(null);
  useEffect(() => {
    const open = (e: Event) => { setAiPanelOpen(true); const p = (e as CustomEvent).detail?.prompt; if (p) setAiPrefill(p); };
    window.addEventListener("buildsasa:open-ai", open);
    return () => window.removeEventListener("buildsasa:open-ai", open);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Chat session lifted here so it persists across panel open/close and module
  // navigation; only "New chat" or a page reload (which remounts App) resets it.
  const aiSession = useAiSession();
  const { messages: aiMessages, setMessages: setAiMessages } = aiSession;
  // "New" (the sidebar's pen) is a fresh chat: you tell the AI what to create.
  // The theme switch lives in the account menu, which doesn't hold the theme.
  useEffect(() => {
    const fresh = () => { aiSession.reset(); setView("buildflex-ai"); };
    const flip = () => setTheme(theme === "dark" ? "light" : "dark");
    window.addEventListener("buildsasa:open-new", fresh);
    window.addEventListener("buildsasa:toggle-theme", flip);
    return () => { window.removeEventListener("buildsasa:open-new", fresh); window.removeEventListener("buildsasa:toggle-theme", flip); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);
  // Sidebar: full, or a rail of icons. The AI page starts on the rail so the
  // chat gets the room; expanding it there only lasts for that visit.
  const [navCollapsed, setNavCollapsed] = useState(() => { try { return localStorage.getItem("buildsasa-nav-collapsed") === "1"; } catch { return false; } });
  const [aiNavOpen, setAiNavOpen] = useState(false);
  // A question typed in a module page's ask bar, waiting for the AI page.
  const [aiStart, setAiStart] = useState<{ text: string; images: string[]; key: number; page?: string } | null>(null);
  // A checklist the AI drafted in chat, queued to open in the Form Builder
  // (inside the Checklists view) as a new, unsaved form.
  const [aiFormDraft, setAiFormDraft] = useState<any | null>(null);
  const openAiForm = (form: AiFormDraft) => {
    setAiFormDraft({ title: form.title, trade: form.trade, category: form.category, items: JSON.stringify(form.items || []), status: "draft" });
    navigate("checklists");
  };
  // Profile settings modal (opened from the sidebar profile menu).
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"profile" | "account" | "company">("profile");
  useEffect(() => {
    const open = (e: Event) => { setSettingsTab((e as CustomEvent).detail?.tab || "profile"); setSettingsOpen(true); };
    window.addEventListener("buildflex:open-settings", open);
    return () => window.removeEventListener("buildflex:open-settings", open);
  }, []);
  // Any screen can ask to go somewhere: dispatch
  //   new CustomEvent("buildsasa:navigate", { detail: { view: "billing" } })
  useEffect(() => {
    const go = (e: Event) => { const v = (e as CustomEvent).detail?.view; if (v) navigate(v as View); };
    window.addEventListener("buildsasa:navigate", go);
    return () => window.removeEventListener("buildsasa:navigate", go);
  }, [navigate]);
  // No seed id. This used to default to "CO-1258", a demo record, so any route
  // that navigated without an id opened someone else's invented change order.
  const [activeChangeOrderId, setActiveChangeOrderId] = useState<string | null>(null);
  const [returnView, setReturnView] = useState<View>("buildflex-ai");
  // Which project the detail dashboard is showing. Set by drilling into a card.
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const openProject = (id: string) => {
    setActiveProjectId(id);
    navigate("project-detail");
    setDrawerOpen(false);
  };
  // Ask the Projects list to open its edit dialog for this project on mount —
  // used by "Edit project" on the detail page, since the form lives there.
  const [editProjectId, setEditProjectId] = useState<string | null>(null);

  // Theme switch. Uses the View Transitions API to crossfade the whole page as a
  // single composited snapshot (smooth, no per-element repaint flicker). Falls
  // back to an instant switch where the API isn't available.
  const setTheme = (t: "dark" | "light") => {
    const apply = () => {
      flushSync(() => {
        setThemeState(t);
        try { localStorage.setItem("constructai-theme", t); } catch { /* noop */ }
      });
      // Keep <html> in sync within the same synchronous step so the snapshot is correct.
      document.documentElement.classList.toggle("theme-light", t === "light");
    };
    const doc = document as any;
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (typeof doc.startViewTransition === "function" && !reduce) {
      doc.startViewTransition(apply);
    } else {
      apply();
    }
  };

  // Sync <html> class in the SAME paint frame as the React re-render.
  // Doing this in useLayoutEffect (before paint) eliminates the one-frame
  // mismatch that caused a white/dark flicker when toggling themes.
  useLayoutEffect(() => {
    if (theme === "light") {
      document.documentElement.classList.add("theme-light");
    } else {
      document.documentElement.classList.remove("theme-light");
    }
  }, [theme]);

  // Reset to first allowed+visible view when role changes
  useEffect(() => {
    if (view === "login") return;
    const allowed = visibleViewsFor(ROLES[role].views);
    if (!allowed.includes(view)) {
      setView(homeView(allowed));
    }
  }, [role]);

  // Subscription gate — stays dormant until Paystack is configured, so local
  // testing is never blocked. Once a key is set, non-subscribers see a paywall.
  // Start locked (active:false) so we NEVER flash the dashboard before the
  // subscription status is known. `gateLoaded` stays false until the first
  // check resolves; until then we hold on a neutral loading screen.
  const [gate, setGate] = useState<{ configured: boolean; active: boolean; overdue: boolean; unpaidDue: string | null; isBillingOwner: boolean; trialDaysLeft?: number | null; trialEnded?: boolean; tier?: "starter" | "business" }>({ configured: false, active: false, overdue: false, unpaidDue: null, isBillingOwner: false });
  const [gateLoaded, setGateLoaded] = useState(false);
  const [gateNonce, setGateNonce] = useState(0);
  useEffect(() => {
    if (view === "login") return;
    let alive = true;
    (async () => {
      try {
        const [plans, sub, invoices] = await Promise.all([
          api.getBillingPlans(),
          api.getSubscription().catch(() => ({ status: "inactive" })),
          api.getBillingInvoices().catch(() => []),
        ]);
        const open = (Array.isArray(invoices) ? invoices : []).filter((i: any) => i.status !== "paid" && i.status !== "void");
        const now = Date.now();
        const soonest = open.map((i: any) => i.dueDate).sort()[0] || null;
        // Only the person who HANDLES billing is stopped by an overdue invoice.
        // Invoices are workspace-scoped, so this used to lock out every teammate
        // in the workspace over the owner's late payment — a site engineer would
        // be shown "Payment required" for a bill they cannot see or settle.
        const isBillingOwner = !!(sub as any)?.isBillingOwner;
        const overdue = isBillingOwner && open.some((i: any) => new Date(i.dueDate).getTime() < now);
        if (alive) setGate({
          configured: !!(plans as any).configured,
          active: (sub as any)?.status === "active",
          overdue,
          unpaidDue: soonest,
          isBillingOwner,
          trialDaysLeft: (sub as any)?.trial ? (sub as any).trialDaysLeft : null,
          tier: (sub as any)?.tier === "starter" ? "starter" : "business",
          trialEnded: !!(sub as any)?.trialEnded,
        });
      } catch { /* ignore */ }
      finally { if (alive) setGateLoaded(true); }
    })();
    return () => { alive = false; };
  }, [view, gateNonce]);

  // Re-check the subscription gate when billing changes (e.g. after a successful
  // Paystack payment) so the paywall lifts immediately, without a manual reload.
  useEffect(() => {
    const bump = () => setGateNonce((n) => n + 1);
    window.addEventListener("buildsasa:billing-updated", bump);
    return () => window.removeEventListener("buildsasa:billing-updated", bump);
  }, []);

  // Email-verification deep link: /?verify=TOKEN — confirm and clean the URL.
  useEffect(() => {
    try {
      const vt = new URLSearchParams(window.location.search).get("verify");
      if (vt) {
        api.verifyEmail(vt)
          .then(() => toast.success("Email verified 🎉"))
          .catch(() => toast.error("That verification link is invalid or has expired."))
          .finally(() => window.history.replaceState({}, "", window.location.pathname));
      }
    } catch { /* noop */ }
  }, []);

  // Trade the one-time Google handoff code for the real session. Held on a
  // loading screen while it runs so the login form never flashes behind it.
  const [oauthExchanging, setOauthExchanging] = useState(() => {
    try { return !!new URLSearchParams(window.location.search).get("handoff"); } catch { return false; }
  });
  useEffect(() => {
    let handoff: string | null = null;
    try { handoff = new URLSearchParams(window.location.search).get("handoff"); } catch { /* noop */ }
    if (!handoff) return;
    // Drop the code from the URL immediately: it is single-use, so a reload or a
    // shared link must not look like it can sign anyone in.
    try { window.history.replaceState({}, "", window.location.pathname); } catch { /* noop */ }
    api.exchangeGoogleHandoff(handoff)
      .then((res) => {
        try {
          localStorage.setItem("constructai-token", res.token);
          if (res.refreshToken) localStorage.setItem("constructai-refresh", res.refreshToken);
          if (res.user) localStorage.setItem("constructai-user", JSON.stringify(res.user));
        } catch { /* noop */ }
        if (res.user?.role && ROLES[res.user.role as Role]) setRole(res.user.role as Role);
        setView("buildflex-ai");
      })
      .catch((e: any) => {
        toast.error(e?.message || "Google sign-in could not be completed. Please try again.");
        setView("login");
      })
      .finally(() => setOauthExchanging(false));
  }, []);

  // Deep-link straight into the Change Orders list with that record's panel open.
  // This used to switch to a separate full-page detail screen — a second view of
  // the same record, and the one still rendering invented figures.
  const openChangeOrder = (id: string) => {
    setActiveChangeOrderId(id);
    navigate("change-orders");
    setDrawerOpen(false);
  };

  // Password-reset deep link: /?reset=TOKEN (works whether or not signed in)
  const resetToken = (() => { try { return new URLSearchParams(window.location.search).get("reset"); } catch { return null; } })();
  if (resetToken) {
    return (
      <div className={`h-screen w-full ${theme === "light" ? "theme-light" : ""}`}>
        <ResetPassword token={resetToken} theme={theme} setTheme={setTheme} />
        <Toaster theme={theme} position="top-right" />
      </div>
    );
  }

  // Public shared form deep link: /?form=TOKEN (no auth required)
  const formToken = (() => { try { return new URLSearchParams(window.location.search).get("form"); } catch { return null; } })();
  if (formToken) {
    return (
      <div className={theme === "light" ? "theme-light" : ""}>
        <PublicFormFill token={formToken} theme={theme} />
        <Toaster theme={theme} position="top-right" />
      </div>
    );
  }

  // Public quote deep link: /?quote=TOKEN (no auth required). Always light: the
  // reader is the job's client, not a workspace user.
  const quoteToken = (() => { try { return new URLSearchParams(window.location.search).get("quote"); } catch { return null; } })();
  if (quoteToken) return <PublicQuoteView token={quoteToken} />;

  // Client portal deep link: /?portal=TOKEN (no auth required).
  const portalToken = (() => { try { return new URLSearchParams(window.location.search).get("portal"); } catch { return null; } })();
  if (portalToken) return <PublicPortalView token={portalToken} />;

  // A buyer's private page for their unit (apartments, estates): /?unit=TOKEN.
  const unitToken = (() => { try { return new URLSearchParams(window.location.search).get("unit"); } catch { return null; } })();
  if (unitToken) return <PublicUnitView token={unitToken} />;

  // Public tender bid deep link: /?bid=TOKEN (no auth required)
  const bidToken = (() => { try { return new URLSearchParams(window.location.search).get("bid"); } catch { return null; } })();
  if (bidToken) {
    return (
      <div className={theme === "light" ? "theme-light" : ""}>
        <PublicBidSubmit token={bidToken} theme={theme} />
        <Toaster theme={theme} position="top-right" />
      </div>
    );
  }

  // Mid-handoff: we have no token yet but one is seconds away. Showing the login
  // form here would tell a user who just authenticated that they are signed out.
  if (oauthExchanging) {
    return (
      <div className={`h-screen w-full flex items-center justify-center ${theme === "light" ? "theme-light bg-[#F6F5F2]" : "bg-[#0A0E14]"}`}>
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 rounded-full border-2 border-[#222A35] border-t-[#FF6B1A] animate-spin" />
          <div className="text-[12.5px] text-[#8A95A5]">Signing you in…</div>
        </div>
        <Toaster theme={theme} position="top-right" />
      </div>
    );
  }

  const authed = (() => { try { return !!localStorage.getItem("constructai-token"); } catch { return false; } })();
  const wantsClient = (() => { try { return new URLSearchParams(window.location.search).get("as") === "client"; } catch { return false; } })();
  const signedInAsClient = (() => { try { return JSON.parse(localStorage.getItem("constructai-user") || "null")?.role === "Client"; } catch { return false; } })();
  if (view === "login" || !authed || (wantsClient && !signedInAsClient)) {
    return (
      <div className={`h-screen w-full ${theme === "light" ? "theme-light" : ""}`}>
        <Login onContinue={(user) => { if (user && user.role && ROLES[user.role as Role]) setRole(user.role as Role); let next: string | null = null; try { next = sessionStorage.getItem("pending-next"); sessionStorage.removeItem("pending-next"); } catch { /* noop */ } void next; setView(sessionStorage.getItem("pending-drawing") ? "plans" : "buildflex-ai"); }} theme={theme} setTheme={setTheme} />
        <Toaster theme={theme} position="top-right" />
      </div>
    );
  }

  // Client accounts (homeowners, landowners) get their own panel; they have no
  // workspace, no paywall and no access to company screens.
  const isClientUser = (() => { try { return JSON.parse(localStorage.getItem("constructai-user") || "null")?.role === "Client"; } catch { return false; } })();
  if (isClientUser) {
    return (
      <div className={theme === "light" ? "theme-light" : ""}>
        <ClientApp theme={theme} setTheme={setTheme} onSignOut={() => { try { localStorage.removeItem("constructai-token"); localStorage.removeItem("constructai-user"); localStorage.removeItem("constructai-refresh"); } catch { /* noop */ } setView("login"); }} />
        <Toaster theme={theme} position="top-right" />
      </div>
    );
  }

  // Authed, but the subscription status isn't known yet. Hold on a neutral
  // loading screen so we never flash the dashboard before the paywall decision.
  if (!gateLoaded) {
    return (
      <div className={`h-screen w-full flex items-center justify-center ${theme === "light" ? "theme-light bg-[#F6F5F2]" : "bg-[#0A0E14]"}`}>
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 rounded-full border-2 border-[#222A35] border-t-[#FF6B1A] animate-spin" />
          <div className="text-[12.5px] text-[#8A95A5]">Loading your workspace…</div>
        </div>
        <Toaster theme={theme} position="top-right" />
      </div>
    );
  }

  // If current view isn't allowed for the role / hidden in this build, bounce
  // to the first allowed + visible view.
  const allowed = visibleViewsFor(ROLES[role].views);
  const effectiveView: View = allowed.includes(view) ? view : homeView(allowed);
  const meta = TITLES[effectiveView as Exclude<View, "login">];
  const backTarget: View = returnView;
  const backMeta = TITLES[backTarget as Exclude<View, "login">];
  // The last page in the trail that is still allowed and isn't this one.
  const backView = [...history].reverse().find((v) => v !== effectiveView && allowed.includes(v));
  // Block (after due date) on an overdue invoice, or when a configured workspace
  // has no active plan. Stays dormant until Paystack is configured so local
  // testing is never blocked. A not-yet-due unpaid invoice shows a soft banner.
  // A workspace needs an active subscription to use the platform. New companies
  // start without one, so they land on a blurred dashboard behind a payment
  // prompt; paid companies get full access. (In demo mode without Paystack,
  // choosing a plan activates instantly so it stays testable.)
  const paywalled = gate.overdue || !gate.active;
  const starter = gate.tier === "starter";
  // Not a hook: this sits below early returns, where hooks would break the render order.
  setPlanTier(starter ? "starter" : "business");
  const invoiceBanner = !paywalled && !!gate.unpaidDue;
  // Only someone who sets up the workspace gets the setup conversation.
  const setsUpWorkspace = !!(ROLES[role].isWorkspaceOwner || ROLES[role].manageTeam);

  return (
    <CurrencyProvider>
      <div
        className={`size-full min-h-screen flex text-[#E6EAF0] ${theme === "light" ? "theme-light bg-[#F6F5F2]" : "bg-[#0A0E14]"}`}
        style={theme === "light" ? { backgroundColor: "#F6F5F2" } : undefined}
      >
        <Sidebar
          view={effectiveView}
          setView={navigate}
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          role={role}
          setRole={setRole}
          locked={paywalled}
          starter={starter}
          activeProjectId={activeProjectId}
          onOpenProject={openProject}
          collapsed={effectiveView === "buildflex-ai" ? !aiNavOpen : navCollapsed}
          onToggleCollapsed={() => {
            if (effectiveView === "buildflex-ai") { setAiNavOpen((x) => !x); return; }
            setNavCollapsed((x) => { try { localStorage.setItem("buildsasa-nav-collapsed", x ? "0" : "1"); } catch { /* noop */ } return !x; });
          }}
        />
        <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
          <Topbar
            title={meta.title}
            onMenu={() => setDrawerOpen(true)}
            onNavigate={(v: View) => navigate(v)}
            projectId={effectiveView === "project-detail" ? activeProjectId : null}
            onOpenProject={openProject}
            onOpenChangeOrder={openChangeOrder}
          />
          <div className={`flex-1 overflow-x-hidden relative ${effectiveView === "buildflex-ai" ? "overflow-hidden" : "overflow-y-auto"}`}>
            {!paywalled && (
              <ModuleTabs view={effectiveView} allowed={(v) => allowed.includes(v)} starter={starter} onNavigate={navigate} />
            )}
            {!paywalled && effectiveView !== "buildflex-ai" && moduleOf(effectiveView) && moduleOf(effectiveView)!.id !== "projects" && (
              <AskBar key={effectiveView} title={askFor(effectiveView).q} hint={askFor(effectiveView).hint}
                onAsk={(text, images) => { setAiStart({ text: text || (images.length ? "Turn this into a modern, finished interior" : ""), images, key: Date.now(), page: meta?.title }); navigate("buildflex-ai"); }} />
            )}
            {paywalled && effectiveView !== "billing" && (
              <div className="fixed inset-0 z-[70] backdrop-blur-lg bg-[#0A0E14]/70 flex items-center justify-center p-6 text-center">
                <div className="max-w-sm w-full rounded-2xl border border-[#222A35] bg-[#11161D] shadow-2xl p-7">
                  <div className="w-12 h-12 rounded-xl bg-[#FF6B1A]/15 border border-[#FF6B1A]/30 flex items-center justify-center mx-auto">
                    <CreditCard className="w-6 h-6 text-[#FF6B1A]" />
                  </div>
                  <div className="text-[18px] text-white font-display mt-4">
                    {gate.overdue ? "Payment required" : gate.isBillingOwner ? (gate.trialEnded ? "Your free trial has ended" : "Activate your workspace") : "This workspace isn't active yet"}
                  </div>
                  {/* A teammate cannot settle their company's bill. Sending them to a
                      checkout they have no authority over is a dead end, so they are
                      told who to speak to instead. */}
                  <p className="text-[12.5px] text-[#8A95A5] mt-2 leading-relaxed">
                    {gate.overdue
                      ? "You have an overdue invoice. Pay it to continue using your workspace."
                      : gate.isBillingOwner
                        ? "Choose a plan to unlock Buildsasa for your company. You can manage or cancel anytime from Billing."
                        : "Your company's Buildsasa plan is not active. Ask whoever manages your account to activate it — you will get straight in once they do."}
                  </p>
                  <div className="flex gap-2 justify-center mt-5">
                    {gate.isBillingOwner && (
                      <button onClick={() => navigate("billing")} className="h-10 px-5 rounded-md bg-[#FF6B1A] hover:bg-[#FF7E33] text-white text-[12.5px]">{gate.overdue ? "Pay invoice" : "Choose a plan"}</button>
                    )}
                    <button onClick={() => { try { localStorage.removeItem("constructai-token"); localStorage.removeItem("constructai-user"); localStorage.removeItem("constructai-refresh"); } catch { /* noop */ } setView("login"); }} className="h-10 px-4 rounded-md border border-[#222A35] text-[#8A95A5] hover:text-white text-[12.5px]">Sign out</button>
                  </div>
                </div>
              </div>
            )}
            {!paywalled && gate.trialDaysLeft != null && effectiveView !== "billing" && (
              <div className="ws-trial" role="status">
                <strong>{gate.trialDaysLeft <= 1 ? "Last day" : `${gate.trialDaysLeft} days left`}</strong> on your free trial. Everything is unlocked until then.{" "}
                {gate.isBillingOwner
                  ? <button type="button" className="ws-link" onClick={() => navigate("billing")}>Choose a plan →</button>
                  : <span>Ask whoever manages your account to choose a plan.</span>}
              </div>
            )}
            {invoiceBanner && effectiveView !== "billing" && (
              <div className="flex items-center gap-3 px-4 sm:px-7 py-2.5 bg-[#F59E0B]/10 border-b border-[#F59E0B]/30">
                <CreditCard className="w-4 h-4 text-[#F59E0B] shrink-0" />
                <div className="text-[12px] text-[#E6EAF0] flex-1">You have an invoice due {gate.unpaidDue ? new Date(gate.unpaidDue).toLocaleDateString() : "soon"}. Pay it to avoid any interruption to your services.</div>
                <button onClick={() => navigate("billing")} className="h-8 px-3 rounded-md bg-[#FF6B1A] hover:bg-[#FF7E33] text-white text-[11.5px] shrink-0">Pay invoice</button>
              </div>
            )}
            {starter && BUSINESS_VIEWS.includes(effectiveView) ? <PlanUpgrade view={effectiveView} onUpgrade={() => navigate("billing")} /> : (
            <ErrorBoundary resetKey={effectiveView} onReset={() => setView(homeView(allowed))}>
            {effectiveView === "dashboard" && (
              <Dashboard
                role={role}
                onOpenChangeOrder={openChangeOrder}
                onNavigate={navigate}
              />
            )}
            {effectiveView === "projects" && (
              <Projects
                setView={navigate}
                role={role}
                onOpenProject={openProject}
                openEditProjectId={editProjectId}
                onConsumeEditProjectId={() => setEditProjectId(null)}
              />
            )}
            {effectiveView === "project-detail" && (
              activeProjectId ? (
                <ProjectDetail
                  key={activeProjectId}
                  projectId={activeProjectId}
                  role={role}
                  setView={navigate}
                  onBack={() => (backView ? goBack() : navigate("projects"))}
                  // Editing lives in the Projects list, which owns the form —
                  // hand the user back there with the dialog already open.
                  onEdit={() => { setEditProjectId(activeProjectId); navigate("projects"); }}
                />
              ) : (
                // Reached without a project selected (e.g. a stale view after a
                // reload). Send the user somewhere useful instead of a blank page.
                <Projects setView={navigate} role={role} onOpenProject={openProject} />
              )
            )}
            {effectiveView === "change-orders" && <ChangeOrders role={role} openId={activeChangeOrderId} onConsumeOpenId={() => setActiveChangeOrderId(null)} />}
            {effectiveView === "billing" && <Billing role={role} />}
            {effectiveView === "plans" && <Plans role={role} />}
            {effectiveView === "tasks" && <ChecklistsHub key="assignments" role={role} initialTab="assignments" />}
            {effectiveView === "schedule" && <Schedule role={role} />}
            {effectiveView === "documents" && <Documents />}
            {effectiveView === "daily-log" && <DailyLog />}
            {effectiveView === "punch-list" && <PunchListPro role={role} />}
            {/* The old standalone Commitments page read fields the API never returns (blank rows); show the real one inside Financials. */}
            {effectiveView === "commitments" && <Financials role={role} initialTab="commitments" only />}
            {effectiveView === "field-view" && <FieldView role={role} />}
            {effectiveView === "reports" && <Reports />}
            {effectiveView === "financials" && <Financials role={role} />}
            {effectiveView === "team" && <TeamMembers role={role} />}
            {effectiveView === "inbox" && <Inbox role={role} />}
            {effectiveView === "announcements" && <Announcements />}
            {effectiveView === "observations" && <Observations role={role} />}
            {effectiveView === "action-plans" && <Observations key="actions" role={role} initialTab="actions" />}
            {effectiveView === "coordination" && <Coordination role={role} />}
            {effectiveView === "correspondence" && <CorrespondenceModule role={role} />}
            {effectiveView === "crews" && <Crews role={role} />}
            {effectiveView === "directory" && <Directory role={role} />}
            {effectiveView === "subcontractors" && <Subcontractors role={role} />}
            {effectiveView === "company-docs" && <CompanyDocs role={role} />}
            {effectiveView === "role-manager" && <RoleManager role={role} />}
            {effectiveView === "quotes" && <Quotes role={role} />}
            {effectiveView === "invoicing" && <Invoicing role={role} />}
            {effectiveView === "inspections" && <Inspections role={role} />}
            {effectiveView === "checklists" && <ChecklistsHub key="checklists" role={role} aiDraft={aiFormDraft} onConsumeAiDraft={() => setAiFormDraft(null)} />}
            {effectiveView === "safety-incidents" && <SafetyIncidents role={role} />}
            {effectiveView === "equipment" && <Inventory role={role} />}
            {effectiveView === "attendance" && <Attendance role={role} />}
            {effectiveView === "buildflex-ai" && <AiWorkspace session={aiSession} canSeeMoney={!!ROLES[role].financials} firstRun={firstRun && setsUpWorkspace} onFirstRunDone={endFirstRun} start={aiStart} onStarted={() => setAiStart(null)} onNavigate={(v) => allowed.includes(v as View) && navigate(v as View)} onOpenProject={openProject} onOpenForm={openAiForm} />}
            </ErrorBoundary>
            )}
          </div>
        </div>
        <Toaster theme={theme} position="top-right" />
        <BuyCreditsModal />
        {settingsOpen && <ProfileSettings initialTab={settingsTab} onClose={() => setSettingsOpen(false)} />}
        {!paywalled && effectiveView !== "buildflex-ai" && <AiAssistantPanel docked open={aiPanelOpen} onClose={() => setAiPanelOpen(false)} onExpand={() => { setAiPanelOpen(false); navigate("buildflex-ai"); }} messages={aiMessages} setMessages={setAiMessages} onOpenForm={openAiForm}
          prefill={aiPrefill} onConsumePrefill={() => setAiPrefill(null)} pageTitle={meta?.title}
          onNavigate={(v) => allowed.includes(v as View) && navigate(v as View)} onOpenProject={openProject} />}
        {/* The support bubble would sit on the docked AI's send button. */}
        {!paywalled && effectiveView !== "buildflex-ai" && !(aiPanelOpen && window.innerWidth >= 1280) && <ShemmySupport />}
      </div>
    </CurrencyProvider>
  );
}
